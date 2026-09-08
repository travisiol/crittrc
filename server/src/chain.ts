import { createPublicClient, defineChain, http, parseAbi } from "viem";
import { config } from "./config";

/**
 * The only thing the server reads on chain: which eggs a wallet holds and
 * which of them have hatched. Everything else (gold, bags, jobs) lives in
 * the server and is written to chain only through a reward window.
 */

const eggsAbi = parseAbi([
  "function tokensOf(address owner) view returns (uint256[])",
  "function speciesOf(uint256 tokenId) view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
]);

const chain = defineChain({
  id: config.chainId,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

export const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
const client = publicClient;
export { chain };

export interface EggInfo {
  tokenId: number;
  species: number;
}

/** Eggs the wallet holds; species 0 means still an egg. */
export async function eggsOf(address: string): Promise<EggInfo[]> {
  if (config.gate !== "eggs") return [];
  const eggs = config.eggsAddress as `0x${string}`;
  const ids = (await client.readContract({
    address: eggs,
    abi: eggsAbi,
    functionName: "tokensOf",
    args: [address as `0x${string}`],
  })) as readonly bigint[];
  const out: EggInfo[] = [];
  for (const id of ids) {
    const species = (await client.readContract({
      address: eggs,
      abi: eggsAbi,
      functionName: "speciesOf",
      args: [id],
    })) as number;
    out.push({ tokenId: Number(id), species: Number(species) });
  }
  return out;
}
