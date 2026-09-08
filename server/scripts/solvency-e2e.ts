/**
 * Proves the server never promises more than the payout contract can pay.
 *
 * It reads the headroom, drains the contract with the owner's rescue call
 * until the headroom is small, then asks for a cash-out worth more than
 * that and checks it is refused with the gold untouched. Finally it puts
 * the tokens back.
 *
 *   cd contracts && npx hardhat node          # and deploy + fund
 *   cd server && ...payout env... npm run dev
 *   cd server && npx tsx scripts/solvency-e2e.ts
 */
import { DatabaseSync } from "node:sqlite";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, formatUnits } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { EarnState } from "../../web/src/shared/protocol";

const base = process.env.SERVER ?? "http://localhost:8787";
const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const dbPath = process.env.DB_PATH ?? "./data/crittr.sqlite";
const OWNER_KEY = (process.env.OWNER_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as `0x${string}`;

const log = (...a: unknown[]) => console.log("[solvency]", ...a);
const fail = (m: string): never => {
  console.error("[solvency] FAIL:", m);
  process.exit(1);
};

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? String(res.status));
  return json;
}

const chain = defineChain({
  id: Number(process.env.CHAIN_ID ?? 31337),
  name: "local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const owner = privateKeyToAccount(OWNER_KEY);
const publicClient = createPublicClient({ chain, transport: http(rpc) });
const ownerWallet = createWalletClient({ account: owner, chain, transport: http(rpc) });
const payoutAbi = parseAbi([
  "function rescue(address to, uint256 amount)",
  "function available() view returns (uint256)",
]);
const erc20Abi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

// ── A keeper with a lot of gold ──────────────────────────────────────
const player = privateKeyToAccount(generatePrivateKey());
const { message, nonce } = await call<{ message: string; nonce: string }>("/auth/nonce", { address: player.address });
const signature = await player.signMessage({ message });
const { session } = await call<{ session: string }>("/auth/verify", {
  address: player.address,
  nonce,
  message,
  signature,
});
await call("/keeper", {
  session,
  name: "solv" + Math.floor(Math.random() * 9000 + 1000),
  look: { skin: 0, eyes: 0, outfit: 0, hair: 0, hat: 0 },
  starter: 1,
});
const GOLD = 500_000; // 5,000.00 gold
{
  const db = new DatabaseSync(dbPath);
  db.prepare("UPDATE keepers SET gold = ? WHERE id = ?").run(GOLD, player.address.toLowerCase());
  db.close();
}
log("keeper holds", (GOLD / 100).toFixed(2), "gold");

let state = await call<EarnState>(`/earn?session=${session}`);
if (!state.enabled) fail(`earning is off: ${state.reason}`);
if (state.headroom === null) fail("no headroom reported — cannot reach the contract");
const decimals = state.decimals;
log("contract holds", formatUnits(BigInt(state.potHolds ?? "0"), decimals));
log("already owed  ", formatUnits(BigInt(state.owed ?? "0"), decimals));
log("headroom      ", formatUnits(BigInt(state.headroom), decimals));

const worth = BigInt(state.goldWorth);
log("that gold is worth", formatUnits(worth, decimals));

// ── Drain the contract so the gold is worth more than it can pay ─────
const payout = state.payout as `0x${string}`;
const before = (await publicClient.readContract({
  address: payout,
  abi: payoutAbi,
  functionName: "available",
})) as bigint;
// Leave a tenth of what the gold is worth, so the ask is clearly over.
const leave = worth / 10n;
const drain = before > leave ? before - leave : 0n;
if (drain > 0n) {
  const hash = await ownerWallet.writeContract({
    address: payout,
    abi: payoutAbi,
    functionName: "rescue",
    args: [owner.address, drain],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  log("drained", formatUnits(drain, decimals), "leaving", formatUnits(leave, decimals));
}

state = await call<EarnState>(`/earn?session=${session}`);
log("headroom now  ", formatUnits(BigInt(state.headroom ?? "0"), decimals));
if (BigInt(state.headroom ?? "0") >= worth) fail("headroom did not shrink below what the gold is worth");

// ── The cash-out must be refused, and the gold must survive ──────────
let refused = "";
try {
  await call("/earn/cashout", { session, gold: "all" });
} catch (e) {
  refused = e instanceof Error ? e.message : String(e);
}
if (!refused) fail("an overdrawn cash-out was accepted");
log("refused:", refused);

state = await call<EarnState>(`/earn?session=${session}`);
if (state.gold !== GOLD) fail(`gold changed: ${state.gold} instead of ${GOLD}`);
if (BigInt(state.earned) !== 0n) fail("an entitlement was created anyway");
log("gold untouched, nothing promised");

// ── A cash-out inside the headroom still works ───────────────────────
const rate = BigInt(state.rate);
const affordableGold = Number((BigInt(state.headroom ?? "0") * 100n) / (rate * 10n ** BigInt(decimals)));
if (affordableGold >= state.minCashoutGold) {
  const out = await call<{ cashedOut: number; tokens: string }>("/earn/cashout", { session, gold: affordableGold });
  log("cashed out", (out.cashedOut / 100).toFixed(2), "gold inside the headroom");
} else {
  log("headroom is below the minimum cash-out; skipping the positive case");
}

// ── Put the tokens back ──────────────────────────────────────────────
if (drain > 0n) {
  const token = state.token as `0x${string}`;
  const hash = await ownerWallet.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: "transfer",
    args: [payout, drain],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  log("refunded the contract");
}

log("OK");
process.exit(0);
