import { describe, it, expect, beforeAll } from "vitest";
const IS_CI = !!process.env.CI;
import { execSync } from "child_process";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { backupConfig, restoreConfig } from "./helpers.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const LOOP_DIR = join(HOME, ".loop");
const SESSION_DIR = join(LOOP_DIR, "sessions");

function run(cmd: string, timeout = 120_000): string {
  return execSync(`npx tsx src/index.ts ${cmd}`, {
    encoding: "utf-8",
    timeout,
  });
}

describe("Story 3.5: Session persistence for follow-up queries", () => {
  beforeAll(() => {
    const cfg = backupConfig();
    rmSync(LOOP_DIR, { recursive: true, force: true });
    restoreConfig(cfg);
    run("ingest fixtures/fleet_sample.xlsx", 30_000);
  }, 60_000);

  it("creates session files on disk", () => {
    run('query --new "List all aircraft types in the fleet."');
    expect(existsSync(SESSION_DIR)).toBe(true);
  }, 120_000);

  it.skipIf(IS_CI)("follow-up query uses previous context", () => {
    // First query — establishes context
    run('query --new "List all aircraft in the fleet spreadsheet with their types."');

    // Follow-up — references previous answer
    const out = run('query "How many of those are Boeing aircraft?"');
    const lower = out.toLowerCase();

    // Should answer about Boeing (B777, B737, B787)
    expect(lower).toMatch(/boeing|b777|b737|b787/i);
  }, 180_000);

  it.skipIf(IS_CI)("--new flag starts a fresh session", () => {
    // This query has no context from previous — should still work by searching corpus
    const out = run('query --new "What type is MSN 4521?"');
    expect(out.toLowerCase()).toContain("b777");
  }, 120_000);
});

describe("Story 3.6: Query export", () => {
  beforeAll(() => {
    // Clean any previous export files
    for (const ext of ["md", "json", "csv"]) {
      const glob = `what_type_is_msn_4521.${ext}`;
      if (existsSync(glob)) rmSync(glob);
    }
  });

  it.skipIf(IS_CI)("exports answer to markdown file", () => {
    const out = run('query --new --output md "What type is MSN 4521?"');

    // Should mention the saved file
    expect(out.toLowerCase()).toContain("saved:");

    // Find the .md file
    const filename = "what_type_is_msn_4521.md";
    expect(existsSync(filename)).toBe(true);

    const content = readFileSync(filename, "utf-8");
    expect(content.toLowerCase()).toContain("b777");

    rmSync(filename);
  }, 120_000);

  it.skipIf(IS_CI)("exports answer to json file", () => {
    run('query --new --output json "What type is MSN 4521?"');

    const filename = "what_type_is_msn_4521.json";
    expect(existsSync(filename)).toBe(true);

    const data = JSON.parse(readFileSync(filename, "utf-8"));
    expect(data.query).toContain("MSN 4521");
    expect(data.answer.toLowerCase()).toContain("b777");

    rmSync(filename);
  }, 120_000);
});
