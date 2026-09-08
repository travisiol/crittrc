/**
 * The six critters. Everything the game knows about a species is here:
 * the type, the job it is good at, and the keepsake it leaves in its nest.
 *
 * Species ids are 1..6 on chain (0 means "still an egg"), so the array is
 * indexed by `id - 1`. Never reorder: the id is what the egg contract emits.
 */

export type JobKind = "forage" | "fish" | "dig";

export type CritterType = "moss" | "gale" | "tide" | "spark" | "stone" | "ember";

export interface Species {
  id: number;
  key: string;
  name: string;
  type: CritterType;
  /** The job where this species pulls fewer junk drops. */
  affinity: JobKind;
  /** One-line dex entry. */
  blurb: string;
  /** What it leaves in its nest once a day. */
  keepsake: string;
  /** Accent colour used by the UI for badges and outlines. */
  color: string;
}

export const SPECIES: readonly Species[] = [
  {
    id: 1,
    key: "mossit",
    name: "Mossit",
    type: "moss",
    affinity: "forage",
    blurb: "A ball of moss that learned to walk. Rolls into thickets and comes out full of berries.",
    keepsake: "moss_tuft",
    color: "#5f9b3a",
  },
  {
    id: 2,
    key: "tidlet",
    name: "Tidlet",
    type: "tide",
    affinity: "fish",
    blurb: "A drop that refused to fall. Sits on the bank and talks the fish into the net.",
    keepsake: "pearl",
    color: "#4aa8e8",
  },
  {
    id: 3,
    key: "wickit",
    name: "Wickit",
    type: "ember",
    affinity: "dig",
    blurb: "A newt with a wick for a tail. Lights the quarry so the ore shows.",
    keepsake: "candle_stub",
    color: "#f2a04a",
  },
  {
    id: 4,
    key: "cobbl",
    name: "Cobbl",
    type: "stone",
    affinity: "dig",
    blurb: "A hedgehog made of gravel. Digs by rolling, which is faster than it looks.",
    keepsake: "flint",
    color: "#8a8f96",
  },
  {
    id: 5,
    key: "buzzlet",
    name: "Buzzlet",
    type: "spark",
    affinity: "fish",
    blurb: "A moth that hums with static. Hovers over the pond and stuns whatever rises.",
    keepsake: "wing_dust",
    color: "#ffd23f",
  },
  {
    id: 6,
    key: "pufflin",
    name: "Pufflin",
    type: "gale",
    affinity: "forage",
    blurb: "Part puffin, part cloud. Shakes the high branches nobody else can reach.",
    keepsake: "down_feather",
    color: "#f6f4ee",
  },
] as const;

export const TYPE_LABEL: Record<CritterType, string> = {
  moss: "Moss",
  gale: "Gale",
  tide: "Tide",
  spark: "Spark",
  stone: "Stone",
  ember: "Ember",
};

export function speciesById(id: number): Species {
  const s = SPECIES[id - 1];
  if (!s) throw new Error(`Unknown species ${id}`);
  return s;
}

export function speciesByKey(key: string): Species | undefined {
  return SPECIES.find((s) => s.key === key);
}

/** Party size: how many critters follow the keeper and can work at once. */
export const PARTY_SIZE = 3;

/**
 * How many critters one keeper may own, hatched and tamed together. The
 * nests pay per critter per day, so without a ceiling a keeper could farm
 * an unbounded number of them.
 */
export const MAX_CRITTERS = 6;

/**
 * Taming: a wild critter joins you when its trust fills. One treat is
 * worth roughly a third of the way, so three or four treats does it.
 */
export const TRUST_FULL = 100;
export const TRUST_PER_TREAT = { min: 25, max: 45 } as const;

/** Nickname rules, shared by the fitting room and the server. */
export const NICKNAME_RE = /^[A-Za-z0-9_]{3,8}$/;
