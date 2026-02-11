/**
 * Shared test helpers.
 *
 * On CI, model config is set in ~/.loop/config.json.
 * Tests that wipe ~/.loop/ must restore it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const CONFIG_PATH = join(HOME, ".loop", "config.json");

/** Read current config.json (returns null if missing) */
export function backupConfig(): string | null {
  try {
    return readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    return null;
  }
}

/** Restore config.json from a backup string */
export function restoreConfig(backup: string | null): void {
  if (backup) {
    mkdirSync(join(HOME, ".loop"), { recursive: true });
    writeFileSync(CONFIG_PATH, backup, "utf-8");
  }
}
