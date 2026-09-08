/**
 * A throwaway SQLite file, one per test file.
 *
 * `src/db.ts` opens the database the moment it is imported — the
 * `new DatabaseSync(config.dbPath)` and the whole `CREATE TABLE` block run
 * at module scope. So DB_PATH has to be in the environment before anything
 * that pulls db.ts in is loaded, which is why this returns the module from
 * a dynamic import rather than letting callers import it at the top.
 *
 *   const { db, dispose } = await openTempDb("gold");
 *   after(dispose);
 *
 * Node's test runner gives every file its own process, so two test files
 * asking for a temp database never see each other's rows.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type DbModule = typeof import("../../src/db");

export interface TempDb {
  /** Everything src/db.ts exports, bound to a fresh file. */
  db: DbModule;
  /** Where the file lives, for tests that want to poke at the folder. */
  dir: string;
  /** Close the handle and remove the file, its -wal and its -shm. */
  dispose(): void;
}

export async function openTempDb(label: string): Promise<TempDb> {
  const dir = mkdtempSync(join(tmpdir(), `crittr-${label}-`));
  const path = join(dir, `${label}.sqlite`);
  process.env.DB_PATH = path;
  const db = (await import("../../src/db")) as DbModule;

  // If something imported db.ts before this ran, the tests would be writing
  // into the real ./data/crittr.sqlite. Fail loudly rather than quietly.
  const { config } = (await import("../../src/config")) as typeof import("../../src/config");
  if (config.dbPath !== path) {
    throw new Error(
      `db.ts was already open on ${config.dbPath}. Set DB_PATH through openTempDb() before importing anything that pulls in src/db.ts.`,
    );
  }

  return {
    db,
    dir,
    dispose() {
      try {
        db.db.close();
      } catch {
        // already closed, or never opened — either way the folder still goes
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A valid Look, since createKeeper stores it as JSON and reads it back. */
export function look(n = 0) {
  return { skin: n % 4, eyes: n % 3, outfit: n % 6, hair: n % 6, hat: n % 4 };
}

/** Wallet-shaped keeper ids, because that is what the server uses for one. */
export function address(n: number): string {
  return "0x" + n.toString(16).padStart(40, "0");
}
