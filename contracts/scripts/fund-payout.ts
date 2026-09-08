import * as fs from "fs";
import * as path from "path";
import hre from "hardhat";
import { ethers, network } from "hardhat";
import { deploymentsDir } from "./lib/exportAbi";

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : undefined;
}

/**
 * Tops the Payout up with CRITTR from the deployer.
 *
 *   AMOUNT=1000000 PAYOUT_ADDRESS=0x… npx hardhat run scripts/fund-payout.ts --network robinhood
 *
 * A freshly deployed Payout holds nothing, so every claim reverts with
 * "Payout: pot is empty" until it is funded. The trade fee and the Hatchery
 * feed it afterwards, but the first players cash out long before that adds up.
 *
 * AMOUNT is in whole CRITTR (18 decimals are added here). PAYOUT_ADDRESS and
 * CRITTR_TOKEN_ADDRESS both fall back to deployments/<network>.json.
 */
async function main() {
  const [deployer] = await ethers.getSigners();

  let recorded: { Payout?: string; CrittrToken?: string } = {};
  const file = path.join(deploymentsDir(hre), `${network.name}.json`);
  if (fs.existsSync(file)) {
    recorded = JSON.parse(fs.readFileSync(file, "utf8")).contracts ?? {};
  }

  const payoutAddress = env("PAYOUT_ADDRESS") ?? recorded.Payout;
  const tokenAddress = env("CRITTR_TOKEN_ADDRESS") ?? recorded.CrittrToken;
  const amountRaw = env("AMOUNT");

  if (!payoutAddress) throw new Error(`Set PAYOUT_ADDRESS (or deploy first so ${file} exists).`);
  if (!tokenAddress) throw new Error(`Set CRITTR_TOKEN_ADDRESS (or deploy first so ${file} exists).`);
  if (!amountRaw) throw new Error("Set AMOUNT to the number of whole CRITTR to send, e.g. AMOUNT=1000000.");

  const amount = ethers.parseUnits(amountRaw, 18);
  const token = await ethers.getContractAt("CrittrToken", tokenAddress);
  const payout = await ethers.getContractAt("Payout", payoutAddress);

  const balance = await token.balanceOf(deployer.address);
  if (balance < amount) {
    throw new Error(`Deployer holds ${ethers.formatUnits(balance, 18)} CRITTR, cannot send ${amountRaw}.`);
  }

  console.log(`Network : ${network.name}`);
  console.log(`From    : ${deployer.address}`);
  console.log(`Token   : ${tokenAddress}`);
  console.log(`Payout  : ${payoutAddress}`);
  console.log(`Amount  : ${amountRaw} CRITTR`);

  const tx = await token.transfer(payoutAddress, amount);
  await tx.wait();

  console.log(`Sent in ${tx.hash}`);
  console.log(`Payout balance now ${ethers.formatUnits(await payout.available(), 18)} CRITTR`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
