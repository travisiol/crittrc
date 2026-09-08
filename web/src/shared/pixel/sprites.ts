/**
 * Every sprite in the game as a character grid. One letter is one pixel and
 * maps to a colour in the sprite's palette; `.` is transparent. Grids are
 * drawn once into an offscreen canvas (see draw.ts) and blitted after that,
 * so the cost of the string format is paid a single time per sprite.
 *
 * Nothing here is traced from an existing game. The six critters are
 * original designs; the keeper is a generic 16x24 figure.
 */

export type Grid = readonly string[];
export type Palette = Record<string, string>;

export interface SpriteDef {
  grid: Grid;
  palette: Palette;
}

// ── Critters (16x16, front view; left/right are horizontal flips) ────

const MOSSIT: SpriteDef = {
  grid: [
    ".......ll.......",
    "......lLLl......",
    ".......lK.......",
    ".....KKKKKK.....",
    "....KmmMMmmK....",
    "...KmMmmmmMmK...",
    "..KmmmmmmmmmmK..",
    "..KmWEmmmmWEmK..",
    "..KmEEmmmmEEmK..",
    "..KmmcmmmmcmmK..",
    "..KmmmmmmmmmmK..",
    "..KmMmmmmmmMmK..",
    "...KmmmmmmmmK...",
    "....KKKKKKKK....",
    ".....Kf..fK.....",
    ".....KK..KK.....",
  ],
  palette: {
    l: "#7bd151",
    L: "#b6f08a",
    K: "#233d1b",
    m: "#5f9b3a",
    M: "#8fcc5a",
    W: "#ffffff",
    E: "#1e2a1c",
    c: "#e08a8a",
    f: "#3c6b28",
  },
};

const TIDLET: SpriteDef = {
  grid: [
    ".......K........",
    "......KbK.......",
    "......KbK.......",
    ".....KbbbK......",
    "....KbbBbbK.....",
    "...KbBbbbbbK....",
    "..KbbbbbbbbbK...",
    "..KbWEbbbbWEbK..",
    "..KbEEbbbbEEbK..",
    "..KbbbbbbbbbbK..",
    "..KbbbcbbbbcbK..",
    "..KBbbbbbbbbBK..",
    "...KbbbbbbbbK...",
    "....KKKKKKKK....",
    ".....Kd..dK.....",
    ".....KK..KK.....",
  ],
  palette: {
    b: "#4aa8e8",
    B: "#a6dcff",
    K: "#1f3f66",
    d: "#2d6fb0",
    W: "#ffffff",
    E: "#10233a",
    c: "#ff9fb0",
  },
};

const WICKIT: SpriteDef = {
  grid: [
    ".......ff.......",
    "......fFFf......",
    "......fFof......",
    ".......Kf.......",
    ".....KKKKK......",
    "....KppppppK....",
    "...KpWEppWEpK...",
    "...KpEEppEEpK...",
    "...KppppppppK...",
    "....KaaaaaaK....",
    "...KpaaaaaapK...",
    "...KpaaaaaapKK..",
    "...KppppppppppK.",
    "....KpKKKKpKKK..",
    "....KK..KK......",
    "................",
  ],
  palette: {
    f: "#ffd23f",
    F: "#ff7a2a",
    o: "#fff7d6",
    K: "#2b1a33",
    p: "#5a3a6b",
    a: "#f2a04a",
    W: "#ffffff",
    E: "#1a0f20",
  },
};

const COBBL: SpriteDef = {
  grid: [
    "................",
    "....K..K..K.....",
    "...KdKKdKKdK....",
    "..KdsssdsssdK...",
    "..KsssssssssK...",
    ".KsssGsssssssK..",
    ".KsssssWEssWEK..",
    ".KsssssEEssEEK..",
    ".KsssssssssssK..",
    ".KssssssscssscK.",
    ".KsssssssssssK..",
    "..KdssssssssK...",
    "...KKKKKKKKK....",
    "....Kd..dK......",
    "....KK..KK......",
    "................",
  ],
  palette: {
    K: "#3a3d44",
    s: "#8a8f96",
    d: "#5c6169",
    G: "#7ee0d0",
    W: "#ffffff",
    E: "#1e2126",
    c: "#c98a8a",
  },
};

const BUZZLET: SpriteDef = {
  grid: [
    ".....K....K.....",
    "..KK.K....K.KK..",
    ".KwwK......KwwK.",
    ".KwwwK....KwwwK.",
    ".KwzwwK..KwwzwK.",
    ".KwwwwKKKKwwwwK.",
    "..KwwKyyyyKwwK..",
    "..KwwKyWEyKwwK..",
    "...KKKyEEyKKK...",
    "....KyyyyyyK....",
    "....KbbbbbbK....",
    "....KyyyyyyK....",
    "....KbbbbbbK....",
    ".....KyyyyK.....",
    "......KKKK......",
    "................",
  ],
  palette: {
    K: "#2b2b2b",
    w: "#fff2a8",
    z: "#6cc4ff",
    y: "#ffd23f",
    b: "#2b2b2b",
    W: "#ffffff",
    E: "#1a1a1a",
  },
};

const PUFFLIN: SpriteDef = {
  grid: [
    "................",
    ".....KKKKK......",
    "....KccccccK....",
    "...KcCccccCcK...",
    "..KccccccccccK..",
    "..KcWEccccWEcK..",
    "..KcEEccccEEcK..",
    "..KcccKooKcccK..",
    "..KcccKoooKccK..",
    "..KccccKKKcccK..",
    "..KCcccccccCcK..",
    "...KcccccccccK..",
    "...KKcccccccK...",
    "....KKKKKKKK....",
    ".....Ko..oK.....",
    ".....KK..KK.....",
  ],
  palette: {
    K: "#4a4a52",
    c: "#f6f4ee",
    C: "#d9d6cc",
    o: "#ff8c42",
    W: "#cfe8ff",
    E: "#1e1e24",
  },
};

/** Indexed by species id - 1. */
export const CRITTER_SPRITES: readonly SpriteDef[] = [MOSSIT, TIDLET, WICKIT, COBBL, BUZZLET, PUFFLIN];

/** The egg, for the hatchery and the fitting room. */
export const EGG: SpriteDef = {
  grid: [
    "................",
    "......KKKK......",
    ".....KeeeeK.....",
    "....KeeEeeeK....",
    "...KeeeeeeeeK...",
    "...KeEeeeeEeK...",
    "..KeeeeeeeeeeK..",
    "..KeeeeEeeeeeK..",
    "..KeeeeeeeeeeK..",
    "..KeEeeeeeeEeK..",
    "..KeeeeeeeeeeK..",
    "...KeeeeEeeeK...",
    "...KeeeeeeeeK...",
    "....KeeeeeeK....",
    ".....KKKKKK.....",
    "................",
  ],
  palette: { K: "#4a4a52", e: "#f3ead2", E: "#c9b98a" },
};

// ── Keeper (16x24). Letters are roles, colours come from the Look. ────
//
//  K outline   h hair   s skin   E eye   o outfit   p pants   S shoe
//  H hat colour (per hat style)

export const KEEPER_HEAD: Record<"front" | "back" | "side", Grid> = {
  front: [
    "................",
    "................",
    "................",
    "....KKKKKKKK....",
    "...KhhhhhhhhK...",
    "..KhhhhhhhhhhK..",
    "..KhhhhhhhhhhK..",
    "..KhsssssssshK..",
    "..KssssssssssK..",
    "..KsEsssssEssK..",
    "..KsEsssssEssK..",
    "..KssssssssssK..",
    "...KssssssssK...",
  ],
  back: [
    "................",
    "................",
    "................",
    "....KKKKKKKK....",
    "...KhhhhhhhhK...",
    "..KhhhhhhhhhhK..",
    "..KhhhhhhhhhhK..",
    "..KhhhhhhhhhhK..",
    "..KhhhhhhhhhhK..",
    "..KhhhhhhhhhhK..",
    "..KhhhhhhhhhhK..",
    "..KhsssssssshK..",
    "...KssssssssK...",
  ],
  // Facing right. Left is a flip.
  side: [
    "................",
    "................",
    "................",
    "....KKKKKKKK....",
    "...KhhhhhhhhK...",
    "..KhhhhhhhhhhK..",
    "..KhhhhhhhhhhK..",
    "..KhhhhhsssshK..",
    "..KhhssssssssK..",
    "..KhssssssEEsK..",
    "..KhssssssEEsK..",
    "..KhsssssssssK..",
    "...KssssssssK...",
  ],
};

/** Rows 13..18: torso and arms, shared by every facing. */
export const KEEPER_TORSO: Grid = [
  "....KKKKKKKK....",
  "....KooooooK....",
  "...KsooooooosK..",
  "...KsooooooosK..",
  "...KsooooooosK..",
  "...KKoooooooKK..",
];

/** Rows 19..23: three leg frames — standing, left step, right step. */
export const KEEPER_LEGS: readonly Grid[] = [
  [
    "....KppppppK....",
    "....KppppppK....",
    "....KppKKppK....",
    "....KppKKppK....",
    "....KSSKKSSK....",
  ],
  [
    "....KppppppK....",
    "....KppppppK....",
    "....KppKKppK....",
    "....KSSKKppK....",
    ".....KK.KSSK....",
  ],
  [
    "....KppppppK....",
    "....KppppppK....",
    "....KppKKppK....",
    "....KppKKSSK....",
    "....KSSK.KK.....",
  ],
];

/** Hats overlay rows 1..6 of the head. Index 0 is "no hat". */
export const KEEPER_HATS: readonly Grid[] = [
  [],
  // cap
  [
    "................",
    "................",
    ".....KKKKKK.....",
    "....KHHHHHHK....",
    "...KHHHHHHHHK...",
    "..KHHHHHHHHHHK..",
    ".KKKKHHHHHHKKKK.",
  ],
  // straw hat
  [
    "................",
    "......KKKK......",
    ".....KHHHHK.....",
    ".....KHhhHK.....",
    "..KKKKHHHHKKKK..",
    ".KHHHHHHHHHHHHK.",
    "..KKKKKKKKKKKK..",
  ],
  // beanie
  [
    "................",
    ".......KK.......",
    ".....KKHHKK.....",
    "....KHHHHHHK....",
    "...KHHHHHHHHK...",
    "..KHhHhHhHhHhK..",
    "..KHHHHHHHHHHK..",
  ],
];

export const HAT_COLORS: readonly [string, string][] = [
  ["#000000", "#000000"],
  ["#d8452e", "#8f2c1c"],
  ["#e8c66a", "#b9963e"],
  ["#2f8f7a", "#1f6353"],
];

export const SKIN_COLORS = ["#f7d7b8", "#e2b58f", "#b8865e", "#7c5236"] as const;
export const EYE_COLORS = ["#2b2b2b", "#3b6bd6", "#3f7a2f"] as const;
export const HAIR_COLORS = ["#2a2020", "#6b4426", "#e2b64a", "#c4552a", "#ece6da", "#4a6fd8"] as const;
export const OUTFIT_COLORS: readonly [string, string][] = [
  ["#4c8f3e", "#2f5a27"],
  ["#3f7fd9", "#274e8a"],
  ["#d8452e", "#7d2a1c"],
  ["#f2c14e", "#8f6d22"],
  ["#8a5bd6", "#4d3280"],
  ["#f1ede3", "#5a5650"],
];
export const OUTLINE = "#241c17";
export const SHOE = "#3b2a1e";

export const LOOK_LABELS = {
  skin: ["Fair", "Tan", "Brown", "Deep"],
  eyes: ["Dark", "Blue", "Green"],
  outfit: ["Leaf", "Sky", "Poppy", "Sun", "Violet", "Linen"],
  hair: ["Black", "Brown", "Blond", "Red", "White", "Blue"],
  hat: ["None", "Cap", "Straw", "Beanie"],
} as const;

/** Small tool held by an NPC or a keeper; 8x12, anchored at the hand. */
export const ROD: SpriteDef = {
  grid: [
    ".......r",
    "......r.",
    ".....r..",
    "....r...",
    "...r....",
    "..r.....",
    ".r......",
    "r.......",
  ],
  palette: { r: "#6b4426" },
};
