import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config } from "./config";
import { db } from "./db";

/**
 * The database holds what every keeper is owed, so it is money now. These
 * snapshots are the difference between a lost disk and a lost livelihood.
 *
 * `VACUUM INTO` writes a consistent copy while the server keeps running,
 * which a plain file copy cannot promise with a write-ahead log open.
 * Restoring is a file move; there is no format to convert.
 */

function backupDir(): string {
  return config.backupDir || join(dirname(resolve(config.dbPath)), "backups");
}

export function backupNow(): string | null {
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(dir, `crittr-${stamp}.sqlite`);
  try {
    // The path goes into SQL text, so quote it the way SQLite expects.
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    prune(dir);
    return target;
  } catch (e) {
    console.error("[crittr] backup failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

function prune(dir: string) {
  const keep = Math.max(1, config.backupKeep);
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("crittr-") && f.endsWith(".sqlite"))
    .map((f) => ({ f, at: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const old of files.slice(keep)) {
    try {
      unlinkSync(join(dir, old.f));
    } catch {
      // A file that is already gone is the outcome we wanted.
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startBackups() {
  if (config.backupMinutes <= 0) {
    console.log("[crittr] backups are off (BACKUP_MINUTES=0) — the entitlement ledger is unprotected");
    return;
  }
  const first = backupNow();
  if (first) console.log(`[crittr] backup -> ${first} (every ${config.backupMinutes} min, keeping ${config.backupKeep})`);
  timer = setInterval(backupNow, config.backupMinutes * 60_000);
  timer.unref();
}

export function stopBackups() {
  if (timer) clearInterval(timer);
  timer = null;
}
