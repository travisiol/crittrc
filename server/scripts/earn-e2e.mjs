/**
 * Proves the whole earning path against a local chain, end to end:
 * sign in -> earn gold -> cash out -> voucher -> claim from the player's
 * own wallet -> tokens actually move -> a replayed voucher pays nothing.
 *
 * Setup, in order:
 *   1. cd contracts && npx hardhat node
 *   2. cd contracts && npx hardhat run scripts/deploy.ts --network localhost
 *   3. cd server && PAYOUT_ADDRESS=... REWARD_TOKEN=... PAYOUT_SIGNER_KEY=...
 *      RPC_URL=http://127.0.0.1:8545 CHAIN_ID=31337 npm run dev
 *   4. node scripts/earn-e2e.mjs
 *
 * The player is Hardhat's account #5, so it has gas. The gold is written
 * straight into the database because earning it honestly would take the
 * length of a real forage; everything after that is the real path.
 */
import { DatabaseSync } from "node:sqlite";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const base = process.env.SERVER ?? "http://localhost:8787";
const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const dbPath = process.env.DB_PATH ?? "./data/crittr.sqlite";
const GOLD = Number(process.env.GOLD ?? 2500); // 25.00 gold

// Hardhat account #5 — a throwaway key that is public by design.
const PLAYER_KEY = process.env.PLAYER_KEY ?? "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";

const log = (...a) => console.log("[earn]", ...a);
const fail = (m) => {
  console.error("[earn] FAIL:", m);
  process.exit(1);
};

async function call(path, body) {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${json.error ?? res.status}`);
  return json;
}

const chain = defineChain({
  id: Number(process.env.CHAIN_ID ?? 31337),
  name: "local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});

const player = privateKeyToAccount(PLAYER_KEY);
const publicClient = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ account: player, chain, transport: http(rpc) });

const payoutAbi = parseAbi([
  "function claim(uint256 cumulative, uint256 deadline, bytes signature) returns (uint256 paid)",
  "function claimed(address) view returns (uint256)",
  "function available() view returns (uint256)",
]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

log("player", player.address);

// ── 1. Sign in ───────────────────────────────────────────────────────
const { message, nonce } = await call("/auth/nonce", { address: player.address });
const signature = await player.signMessage({ message });
const verified = await call("/auth/verify", { address: player.address, nonce, message, signature });
if (!verified.session) fail("no session");
const session = verified.session;
log("signed in");

// ── 2. A keeper, unless this wallet already has one ──────────────────
if (!verified.keeper) {
  const name = "earn" + Math.floor(Math.random() * 9000 + 1000);
  await call("/keeper", { session, name, look: { skin: 1, eyes: 1, outfit: 2, hair: 2, hat: 1 }, starter: 2 });
  log("keeper", name);
} else {
  log("keeper", verified.keeper.name, "(already existed)");
}

// ── 3. Gold, granted rather than farmed ──────────────────────────────
{
  const db = new DatabaseSync(dbPath);
  db.prepare("UPDATE keepers SET gold = gold + ? WHERE id = ?").run(GOLD, player.address.toLowerCase());
  db.close();
  log("granted", (GOLD / 100).toFixed(2), "gold");
}

// ── 4. What the bank says ────────────────────────────────────────────
let state = await call(`/earn?session=${session}`);
if (!state.enabled) fail(`earning is off: ${state.reason}`);
if (state.signerMatches === false) fail("the contract does not recognise the server's signing key");
log(`rate ${state.rate} per gold · gold ${(state.gold / 100).toFixed(2)} · worth ${state.goldWorth}`);
if (BigInt(state.goldWorth) <= 0n) fail("gold is worth nothing");
const potBefore = BigInt(state.potHolds);
if (potBefore <= 0n) fail("the payout contract holds nothing — fund it first");
log("pot holds", potBefore.toString());

// ── 5. Cash out ──────────────────────────────────────────────────────
const before = await publicClient.readContract({
  address: state.token,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [player.address],
});
const cash = await call("/earn/cashout", { session, gold: "all" });
log("cashed out", (cash.cashedOut / 100).toFixed(2), "gold for", cash.tokens, "units");
if (cash.state.gold !== 0) fail("gold was not spent");
if (BigInt(cash.state.claimable) <= 0n) fail("nothing became claimable");

// Cashing out again with no gold must be refused.
await call("/earn/cashout", { session, gold: "all" })
  .then(() => fail("cashing out zero gold was accepted"))
  .catch((e) => log("empty cash-out refused:", e.message));

// ── 6. Voucher, then claim from the player's own wallet ──────────────
const { voucher } = await call("/earn/voucher", { session });
log("voucher for", voucher.cumulative, "valid", new Date(voucher.deadline * 1000).toISOString());
if (voucher.account.toLowerCase() !== player.address.toLowerCase()) fail("voucher is for another wallet");

const hash = await wallet.writeContract({
  address: voucher.payout,
  abi: payoutAbi,
  functionName: "claim",
  args: [BigInt(voucher.cumulative), BigInt(voucher.deadline), voucher.signature],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") fail("claim reverted");
log("claimed in block", receipt.blockNumber);

const after = await publicClient.readContract({
  address: state.token,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [player.address],
});
const moved = after - before;
log("wallet balance moved by", moved.toString());
if (moved !== BigInt(cash.tokens)) fail(`expected ${cash.tokens}, wallet moved ${moved}`);

// ── 7. The same voucher again must pay nothing ───────────────────────
try {
  await publicClient.simulateContract({
    account: player,
    address: voucher.payout,
    abi: payoutAbi,
    functionName: "claim",
    args: [BigInt(voucher.cumulative), BigInt(voucher.deadline), voucher.signature],
  });
  fail("a replayed voucher was accepted");
} catch (e) {
  const text = String(e.message ?? e).split("\n")[0];
  log("replay refused:", text.slice(0, 90));
}

// ── 8. The bank agrees ───────────────────────────────────────────────
state = await call(`/earn?session=${session}`);
if (BigInt(state.claimable) !== 0n) fail(`claimable should be 0, is ${state.claimable}`);
if (state.claimedOnChain !== cash.state.earned) fail("on-chain claimed does not match the entitlement");
log("bank agrees: claimable 0, claimed on chain", state.claimedOnChain);

log("OK");
process.exit(0);
