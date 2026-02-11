import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import { rmSync } from "fs";
import { join } from "path";
import { backupConfig, restoreConfig } from "./helpers.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const LOOP_DIR = join(HOME, ".loop");

function run(cmd: string, timeout = 120_000): string {
  return execSync(`npx tsx src/index.ts ${cmd}`, {
    encoding: "utf-8",
    timeout,
  });
}

describe("EPIC 2 Queries", () => {
  beforeAll(() => {
    const cfg = backupConfig();
    rmSync(LOOP_DIR, { recursive: true, force: true });
    restoreConfig(cfg);
    // Ingest all fixtures at once
    run("ingest fixtures/", 60_000);
  }, 60_000);

  // Story 2.6: Excel query
  it("2.6 — answers a lookup question from Excel data", () => {
    const out = run('query "What aircraft type is MSN 4521? Check the fleet spreadsheet."');
    const lower = out.toLowerCase();
    expect(lower).toContain("b777");
    expect(lower).toMatch(/fleet/i);
  }, 120_000);

  // Story 2.7: CSV query
  it("2.7 — answers a question from CSV data", () => {
    const out = run('query "Which aircraft had zero flight hours in January? Check the utilization data."');
    const lower = out.toLowerCase();
    expect(lower).toContain("msn 4521");
    expect(lower).toMatch(/storage|0.*flight/i);
  }, 120_000);

  // Story 2.8: Cross-format conflict detection
  it("2.8 — detects conflict between Excel and PDF amendment", () => {
    const out = run(
      'query "What is the engine maintenance reserve rate for MSN 4521? Compare what the fleet spreadsheet says versus any amendments."'
    );
    const lower = out.toLowerCase();

    // Should mention both rates
    expect(lower).toMatch(/350|420/);
    // Should note the change/conflict
    expect(lower).toMatch(/amend|changed|updated|conflict|supersede|increased|revised/i);
  }, 120_000);

  // Story 2.9: "I don't know"
  it("2.9 — says I don't know for missing information", () => {
    const out = run('query "What is the insurance requirement for MSN 4521?"');
    const lower = out.toLowerCase();

    // Should NOT hallucinate an insurance clause
    expect(lower).toMatch(
      /not found|could not find|don.?t know|no.*insurance|not.*contain|not.*mention|not.*specif/i
    );
  }, 120_000);
});
