/**
 * Everything the server reads from the environment, with the defaults a
 * fresh checkout runs on. Nothing here is secret except SESSION_SECRET.
 */

const env = (k: string, d = ""): string => (process.env[k] ?? d).trim();

export const config = {
  port: Number(env("PORT", "8787")),
  /** Where the SQLite file lives. */
  dbPath: env("DB_PATH", "./data/crittr.sqlite"),
  /** Allowed browser origin for HTTP and WebSocket. "*" in development. */
  origin: env("ORIGIN", "*"),
  /**
   * "open"  — a wallet is enough to walk in and every new keeper gets a
   *           starter critter of the species they pick.
   * "eggs"  — the door checks the egg collection on chain; critters are
   *           the hatched eggs the wallet holds. Needs EGGS_ADDRESS.
   */
  gate: env("GATE", "open") as "open" | "eggs",
  eggsAddress: env("EGGS_ADDRESS"),
  rpcUrl: env("RPC_URL", "https://rpc.mainnet.chain.robinhood.com"),
  chainId: Number(env("CHAIN_ID", "4663")),
  /** Multiplier on job durations. 0.05 makes a two-minute forage six seconds. */
  jobScale: Number(env("JOB_SCALE", "1")),
  /** Rooms are copies of the meadow. */
  roomCount: Number(env("ROOM_COUNT", "5")),
  roomCap: Number(env("ROOM_CAP", "100")),
  wildPerRoom: Number(env("WILD_PER_ROOM", "6")),
  /**
   * Keepers the game runs itself, so the first person through the door
   * does not arrive somewhere empty. They are real inhabitants — they
   * walk, work spots and talk — but they hold no wallet and can never
   * earn or claim anything. Set to 0 for an empty world.
   */
  botCount: Number(env("BOT_COUNT", "34")),
  botChat: env("BOT_CHAT", "true") !== "false",
  sessionDays: Number(env("SESSION_DAYS", "7")),
  /** Seconds between two keeper creations from the same connection. */
  nameCooldownSeconds: Number(env("NAME_COOLDOWN_SECONDS", "3600")),
  /** Signed-in message prefix; shown to the user in their wallet. */
  appName: env("APP_NAME", "CRITTR"),

  // ── Earning the token ─────────────────────────────────────────────
  /**
   * The Payout contract players claim from, the ERC-20 it pays, and the
   * key that signs vouchers. All three must be set before anyone can turn
   * gold into tokens; with any of them missing the game says so and
   * refuses to cash gold out, rather than handing out promises it cannot
   * keep.
   */
  payoutAddress: env("PAYOUT_ADDRESS"),
  rewardToken: env("REWARD_TOKEN"),
  rewardTokenSymbol: env("REWARD_TOKEN_SYMBOL", "CRITTR"),
  rewardTokenDecimals: Number(env("REWARD_TOKEN_DECIMALS", "18")),
  /**
   * Development convenience. In production this belongs in a signer
   * service or a KMS, never in a file on the game server.
   */
  payoutSignerKey: env("PAYOUT_SIGNER_KEY"),
  /** Whole tokens paid per 1.00 gold. Published in the UI; may change. */
  tokensPerGold: env("TOKENS_PER_GOLD", "10"),
  /** Smallest cash-out, in gold hundredths. Keeps vouchers meaningful. */
  minCashoutGold: Number(env("MIN_CASHOUT_GOLD", "100")),
  /** How long a signed voucher stays valid. */
  voucherMinutes: Number(env("VOUCHER_MINUTES", "30")),
  /**
   * The server refuses to hand out more entitlement than the payout
   * contract is holding, so a cash-out can never become a debt nobody can
   * pay. This is the slice of the balance it will not promise away, in
   * percent, as a cushion against a fee stream that stops.
   */
  solvencyBufferPct: Number(env("SOLVENCY_BUFFER_PCT", "5")),
  /**
   * With the door open anyone can make a keeper from any wallet, and every
   * keeper can cash out. Earning and an open door together are free money
   * for a script, so the server refuses to start that way unless somebody
   * says out loud that it is a test.
   */
  allowOpenGateEarning: env("ALLOW_OPEN_GATE_EARNING") === "true",

  // ── Keeping the ledger ────────────────────────────────────────────
  backupDir: env("BACKUP_DIR"),
  backupMinutes: Number(env("BACKUP_MINUTES", "30")),
  backupKeep: Number(env("BACKUP_KEEP", "48")),
};

/** True when a player could actually claim something today. */
export function earningConfigured(): boolean {
  return (
    /^0x[0-9a-fA-F]{40}$/.test(config.payoutAddress) &&
    /^0x[0-9a-fA-F]{40}$/.test(config.rewardToken) &&
    /^0x[0-9a-fA-F]{64}$/.test(config.payoutSignerKey)
  );
}

/** Why earning is off, in words a player can act on. */
export function earningReason(): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(config.payoutAddress)) return "The payout contract is not deployed yet.";
  if (!/^0x[0-9a-fA-F]{40}$/.test(config.rewardToken)) return "The token address is not set yet.";
  if (!/^0x[0-9a-fA-F]{64}$/.test(config.payoutSignerKey)) return "The game has no signing key yet.";
  return null;
}

export function assertConfig() {
  if (config.gate === "eggs" && !/^0x[0-9a-fA-F]{40}$/.test(config.eggsAddress)) {
    throw new Error("GATE=eggs needs EGGS_ADDRESS to be a contract address");
  }
  if (!(config.jobScale > 0)) throw new Error("JOB_SCALE must be > 0");
  if (earningConfigured() && config.gate === "open" && !config.allowOpenGateEarning) {
    throw new Error(
      [
        "Refusing to start: earning is configured while the door is open.",
        "",
        "With GATE=open any wallet gets a keeper, and every keeper can cash",
        "gold out. Nothing stops one person making ten thousand wallets, so",
        "the payout contract would be emptied by a script rather than played for.",
        "",
        "Set GATE=eggs (and EGGS_ADDRESS) so a keeper costs an egg, or set",
        "ALLOW_OPEN_GATE_EARNING=true if this is a local test chain.",
      ].join("\n"),
    );
  }
  if (config.solvencyBufferPct < 0 || config.solvencyBufferPct >= 100) {
    throw new Error("SOLVENCY_BUFFER_PCT must be between 0 and 99");
  }
}
