import * as fs from "fs";
import * as path from "path";
import hre from "hardhat";
import { ethers, network } from "hardhat";
import { deploymentsDir, exportAbis, type DeploymentRecord } from "./lib/exportAbi";

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : undefined;
}

/**
 * Deploys and wires the five contracts:
 *
 *   CrittrToken ──fee──▶ Payout ◀──half of hatch fee── Hatchery ──hatch()──▶ CritterEggs
 *                            ▲
 *                            └── players claim server-signed vouchers here
 *
 *   RewardPot stays deployed as the optional Merkle-window batch tool; it holds
 *   nothing until someone transfers CRITTR to it.
 *
 * Order: Token → RewardPot(token) → Payout(token, signer, owner) → Eggs →
 *        Hatchery(eggs, token, payout), then
 *   eggs.setHatcher(hatchery)
 *   token.setPot(payout)                 // the trade fee funds what the game pays out of
 *   token.setFeeExempt(payout, true)
 *   token.setFeeExempt(rewardPot, true)
 *   token.setFeeExempt(hatchery, true)
 *
 * The deployer owns everything and holds the full CRITTR supply.
 * Optional env: PAYOUT_SIGNER_ADDRESS, EGG_PRICE_WEI, BASE_URI, CONTRACT_URI.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log(`Network   : ${network.name} (chainId ${chainId})`);
  console.log(`Deployer  : ${deployer.address}`);

  // The key the game server signs claim vouchers with. It can attest any
  // amount, so in production it should be a dedicated hot key, not the deployer.
  const configuredSigner = env("PAYOUT_SIGNER_ADDRESS");
  const payoutSigner = configuredSigner ?? deployer.address;
  if (!configuredSigner) {
    console.warn(
      `WARNING   : PAYOUT_SIGNER_ADDRESS is not set — falling back to the deployer as the payout signer. Set it, or call payout.setSigner(<server key>) before going live.`,
    );
  }
  console.log(`Signer    : ${payoutSigner}${configuredSigner ? "" : " (deployer fallback)"}`);

  // ── CrittrToken ──────────────────────────────────────────────────────────
  const token = await (await ethers.getContractFactory("CrittrToken")).deploy(deployer.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`CrittrToken : ${tokenAddress}`);

  // ── RewardPot ────────────────────────────────────────────────────────────
  const pot = await (await ethers.getContractFactory("RewardPot")).deploy(deployer.address, tokenAddress);
  await pot.waitForDeployment();
  const potAddress = await pot.getAddress();
  console.log(`RewardPot   : ${potAddress}`);

  // ── Payout ───────────────────────────────────────────────────────────────
  const payout = await (
    await ethers.getContractFactory("Payout")
  ).deploy(tokenAddress, payoutSigner, deployer.address);
  await payout.waitForDeployment();
  const payoutAddress = await payout.getAddress();
  console.log(`Payout      : ${payoutAddress}`);

  // ── CritterEggs ──────────────────────────────────────────────────────────
  const eggs = await (await ethers.getContractFactory("CritterEggs")).deploy(deployer.address);
  await eggs.waitForDeployment();
  const eggsAddress = await eggs.getAddress();
  console.log(`CritterEggs : ${eggsAddress}`);

  // ── Hatchery ─────────────────────────────────────────────────────────────
  const hatchery = await (
    await ethers.getContractFactory("Hatchery")
  ).deploy(deployer.address, eggsAddress, tokenAddress, payoutAddress);
  await hatchery.waitForDeployment();
  const hatcheryAddress = await hatchery.getAddress();
  console.log(`Hatchery    : ${hatcheryAddress}`);

  // ── Wiring ───────────────────────────────────────────────────────────────
  console.log("Wiring…");
  await (await eggs.setHatcher(hatcheryAddress)).wait();
  await (await token.setPot(payoutAddress)).wait();
  await (await token.setFeeExempt(payoutAddress, true)).wait();
  await (await token.setFeeExempt(potAddress, true)).wait();
  await (await token.setFeeExempt(hatcheryAddress, true)).wait();

  const eggPrice = env("EGG_PRICE_WEI");
  if (eggPrice) await (await eggs.setPrice(BigInt(eggPrice))).wait();
  const baseUri = env("BASE_URI");
  if (baseUri) await (await eggs.setBaseURI(baseUri)).wait();
  const contractUri = env("CONTRACT_URI");
  if (contractUri) await (await eggs.setContractURI(contractUri)).wait();

  // ── Record + export ──────────────────────────────────────────────────────
  const record: DeploymentRecord = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      CritterEggs: eggsAddress,
      CrittrToken: tokenAddress,
      RewardPot: potAddress,
      Payout: payoutAddress,
      Hatchery: hatcheryAddress,
    },
  };

  const dir = deploymentsDir(hre);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  console.log(`Deployment written to ${path.relative(process.cwd(), file)}`);

  await exportAbis(hre);

  console.log("\nAdd to web/.env.local:");
  console.log(`NEXT_PUBLIC_EGGS_ADDRESS=${eggsAddress}`);
  console.log(`NEXT_PUBLIC_CRITTR_TOKEN=${tokenAddress}`);
  console.log(`NEXT_PUBLIC_REWARD_POT=${potAddress}`);
  console.log(`NEXT_PUBLIC_PAYOUT=${payoutAddress}`);
  console.log(`NEXT_PUBLIC_HATCHERY=${hatcheryAddress}`);

  console.log("\nAdd to server/.env:");
  console.log(`PAYOUT_ADDRESS=${payoutAddress}`);
  console.log(`REWARD_TOKEN=${tokenAddress}`);

  console.log("\nNext steps:");
  console.log("  1. Fund the Payout — a Payout with no balance makes every claim revert");
  console.log('     with "Payout: pot is empty":');
  console.log(`       PAYOUT_ADDRESS=${payoutAddress} AMOUNT=1000000 npx hardhat run scripts/fund-payout.ts --network ${network.name}`);
  console.log("  2. Create the CRITTR liquidity pool, then token.setPair(<pool>, true).");
  console.log("  3. eggs.setSaleOpen(true) when the mint should start.");
  console.log("  4. Give the server the private key whose address is payout.signer().");
  console.log("  5. Optional batch tool: transfer CRITTR to the RewardPot, then pot.openWindow(root, total, closesAt).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
