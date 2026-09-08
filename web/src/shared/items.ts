import type { JobKind } from "./species";

/**
 * Every item that can sit in a bag, what the trader pays for it, and how
 * often a job brings it back. Prices are in gold with two decimals; the
 * server stores gold as integer hundredths, so 2.5 gold is 250.
 */

export type ItemRarity = "junk" | "common" | "uncommon" | "rare" | "very_rare";

export interface Item {
  key: string;
  name: string;
  /** What the trader pays, in hundredths of gold. 0 for junk. */
  price: number;
  rarity: ItemRarity;
  /** Which job drops it; keepsakes and shop goods have none. */
  from?: JobKind | "nest" | "shop";
  /** Emoji-free pixel glyph key, see pixel/items. */
  glyph: string;
}

export const ITEMS: Record<string, Item> = {
  // ── Forage (thicket) ──────────────────────────────────────────────
  bramble_berry: { key: "bramble_berry", name: "Bramble berry", price: 150, rarity: "common", from: "forage", glyph: "berry" },
  honey_pod: { key: "honey_pod", name: "Honey pod", price: 450, rarity: "uncommon", from: "forage", glyph: "pod" },
  moon_cap: { key: "moon_cap", name: "Moon cap", price: 1200, rarity: "rare", from: "forage", glyph: "cap" },
  king_truffle: { key: "king_truffle", name: "King truffle", price: 4000, rarity: "very_rare", from: "forage", glyph: "truffle" },
  dead_leaves: { key: "dead_leaves", name: "Dead leaves", price: 0, rarity: "junk", from: "forage", glyph: "leaves" },
  snapped_twig: { key: "snapped_twig", name: "Snapped twig", price: 0, rarity: "junk", from: "forage", glyph: "twig" },
  empty_nest: { key: "empty_nest", name: "Empty nest", price: 0, rarity: "junk", from: "forage", glyph: "nest" },

  // ── Fish (pond) ───────────────────────────────────────────────────
  pond_minnow: { key: "pond_minnow", name: "Pond minnow", price: 200, rarity: "common", from: "fish", glyph: "minnow" },
  mirror_bass: { key: "mirror_bass", name: "Mirror bass", price: 600, rarity: "uncommon", from: "fish", glyph: "bass" },
  glass_pike: { key: "glass_pike", name: "Glass pike", price: 1500, rarity: "rare", from: "fish", glyph: "pike" },
  gilded_koi: { key: "gilded_koi", name: "Gilded koi", price: 5000, rarity: "very_rare", from: "fish", glyph: "koi" },
  old_boot: { key: "old_boot", name: "Old boot", price: 0, rarity: "junk", from: "fish", glyph: "boot" },
  tin_can: { key: "tin_can", name: "Tin can", price: 0, rarity: "junk", from: "fish", glyph: "can" },
  pond_weed: { key: "pond_weed", name: "Pond weed", price: 0, rarity: "junk", from: "fish", glyph: "weed" },

  // ── Dig (quarry) ──────────────────────────────────────────────────
  copper_nugget: { key: "copper_nugget", name: "Copper nugget", price: 250, rarity: "common", from: "dig", glyph: "copper" },
  silver_vein: { key: "silver_vein", name: "Silver vein", price: 700, rarity: "uncommon", from: "dig", glyph: "silver" },
  ember_opal: { key: "ember_opal", name: "Ember opal", price: 1800, rarity: "rare", from: "dig", glyph: "opal" },
  star_shard: { key: "star_shard", name: "Star shard", price: 6000, rarity: "very_rare", from: "dig", glyph: "shard" },
  gravel: { key: "gravel", name: "Gravel", price: 0, rarity: "junk", from: "dig", glyph: "gravel" },
  rusty_nail: { key: "rusty_nail", name: "Rusty nail", price: 0, rarity: "junk", from: "dig", glyph: "nail" },
  cracked_pot: { key: "cracked_pot", name: "Cracked pot", price: 0, rarity: "junk", from: "dig", glyph: "pot" },

  // ── Keepsakes (nests) ─────────────────────────────────────────────
  moss_tuft: { key: "moss_tuft", name: "Moss tuft", price: 100, rarity: "common", from: "nest", glyph: "tuft" },
  pearl: { key: "pearl", name: "Pearl", price: 250, rarity: "common", from: "nest", glyph: "pearl" },
  candle_stub: { key: "candle_stub", name: "Candle stub", price: 150, rarity: "common", from: "nest", glyph: "stub" },
  flint: { key: "flint", name: "Flint", price: 150, rarity: "common", from: "nest", glyph: "flint" },
  wing_dust: { key: "wing_dust", name: "Wing dust", price: 200, rarity: "common", from: "nest", glyph: "dust" },
  down_feather: { key: "down_feather", name: "Down feather", price: 200, rarity: "common", from: "nest", glyph: "feather" },

  // ── Shop ──────────────────────────────────────────────────────────
  treat: { key: "treat", name: "Treat", price: 0, rarity: "common", from: "shop", glyph: "treat" },
};

/** What the trader sells, in hundredths of gold. */
export const SHOP: Record<string, number> = {
  treat: 50,
};

/** How much the trader buys per keeper per day, in hundredths of gold. */
export const TRADER_DAILY_CAP = 10_000;

/** Bag capacity, in item stacks counted one per unit. */
export const BAG_CAPACITY = 24;

/** How long each job takes, in seconds. The server may scale these. */
export const JOB_SECONDS: Record<JobKind, number> = {
  forage: 120,
  fish: 180,
  dig: 240,
};

/** Loot weights per job. Junk first so the tables read as odds at a glance. */
export interface LootRow {
  item: string;
  weight: number;
}

export const LOOT: Record<JobKind, LootRow[]> = {
  forage: [
    { item: "dead_leaves", weight: 22 },
    { item: "snapped_twig", weight: 20 },
    { item: "empty_nest", weight: 14 },
    { item: "bramble_berry", weight: 26 },
    { item: "honey_pod", weight: 11 },
    { item: "moon_cap", weight: 5 },
    { item: "king_truffle", weight: 2 },
  ],
  fish: [
    { item: "old_boot", weight: 22 },
    { item: "tin_can", weight: 20 },
    { item: "pond_weed", weight: 14 },
    { item: "pond_minnow", weight: 26 },
    { item: "mirror_bass", weight: 11 },
    { item: "glass_pike", weight: 5 },
    { item: "gilded_koi", weight: 2 },
  ],
  dig: [
    { item: "gravel", weight: 22 },
    { item: "rusty_nail", weight: 20 },
    { item: "cracked_pot", weight: 14 },
    { item: "copper_nugget", weight: 26 },
    { item: "silver_vein", weight: 11 },
    { item: "ember_opal", weight: 5 },
    { item: "star_shard", weight: 2 },
  ],
};

/**
 * Affinity and treats do the same thing in the same way: they take weight
 * away from junk. An affinity critter halves junk; a fed critter halves it
 * again. The removed weight is not redistributed, so real drops keep their
 * relative odds and only the junk share moves.
 */
export function lootTable(job: JobKind, opts: { affinity: boolean; fed: boolean }): LootRow[] {
  let junkScale = 1;
  if (opts.affinity) junkScale *= 0.5;
  if (opts.fed) junkScale *= 0.5;
  return LOOT[job].map((row) =>
    ITEMS[row.item].rarity === "junk" ? { ...row, weight: row.weight * junkScale } : row,
  );
}

export function rollLoot(table: LootRow[], rnd: () => number): string {
  const total = table.reduce((s, r) => s + r.weight, 0);
  let x = rnd() * total;
  for (const row of table) {
    x -= row.weight;
    if (x <= 0) return row.item;
  }
  return table[table.length - 1].item;
}

export function formatGold(hundredths: number): string {
  return (hundredths / 100).toFixed(2);
}

export const JOB_LABEL: Record<JobKind, { verb: string; place: string; noun: string }> = {
  forage: { verb: "forage", place: "the thicket", noun: "Foraging" },
  fish: { verb: "fish", place: "the pond", noun: "Fishing" },
  dig: { verb: "dig", place: "the quarry", noun: "Digging" },
};
