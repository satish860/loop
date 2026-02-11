import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { backupConfig, restoreConfig } from "./helpers.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const CORPUS_DIR = join(HOME, ".loop", "corpus");
const PDF = "fixtures/BESTBUY_2023_10K.pdf";

/**
 * EPIC 1 End-to-End: Ingest a real PDF → Query with real LLM → Correct cited answer
 *
 * Ground truth: Best Buy is incorporated in Minnesota.
 * Source: BESTBUY_2023_10K.pdf (10-K filing, page 1 area)
 */
describe("Story 1.9: End-to-end — PDF ingest → query → correct cited answer", () => {
  beforeAll(() => {
    // Clean slate — preserve model config for CI
    const cfg = backupConfig();
    rmSync(join(HOME, ".loop"), { recursive: true, force: true });
    restoreConfig(cfg);
  });

  it("ingests the PDF successfully", () => {
    const out = execSync(`npx tsx src/index.ts ingest ${PDF}`, {
      encoding: "utf-8",
      timeout: 60_000,
    });

    // Verify ingest output
    expect(out).toContain("Parsing:");
    expect(out).toContain("Stored:");
    expect(out).toContain("Corpus: 1 document");

    // Verify corpus files created
    expect(existsSync(join(CORPUS_DIR, "BESTBUY_2023_10K.txt"))).toBe(true);
    expect(existsSync(join(CORPUS_DIR, "INDEX.md"))).toBe(true);

    // Verify INDEX.md content
    const index = readFileSync(join(CORPUS_DIR, "INDEX.md"), "utf-8");
    expect(index).toContain("1 document");
    expect(index).toContain("BESTBUY_2023_10K.txt");
  }, 60_000);

  it("answers a factual question correctly with citation", () => {
    const out = execSync(
      'npx tsx src/index.ts query "In what state is Best Buy incorporated?"',
      { encoding: "utf-8", timeout: 120_000 }
    );

    const lower = out.toLowerCase();

    // Ground truth: Minnesota
    expect(lower).toContain("minnesota");

    // Citation present — must reference the source file
    expect(lower).toMatch(/bestbuy/i);

    // Page reference present
    expect(lower).toMatch(/page/i);
  }, 120_000);

  it("answers a numerical question correctly with citation", () => {
    const out = execSync(
      'npx tsx src/index.ts query "How many stores did Best Buy operate at the end of fiscal 2023?"',
      { encoding: "utf-8", timeout: 120_000 }
    );

    const lower = out.toLowerCase();

    // Should contain a number (Best Buy operated ~1,000+ stores)
    expect(lower).toMatch(/\d{3,}/);

    // Citation present
    expect(lower).toMatch(/bestbuy/i);
    expect(lower).toMatch(/page/i);
  }, 120_000);

  it("says 'I don't know' for information not in the document", () => {
    const out = execSync(
      'npx tsx src/index.ts query "What was Apple\'s revenue in 2023?"',
      { encoding: "utf-8", timeout: 120_000 }
    );

    const lower = out.toLowerCase();

    // Should NOT hallucinate Apple revenue
    // Should indicate the information wasn't found
    expect(lower).toMatch(/don.?t know|not found|could not find|no.*information|not.*contain|not.*available/i);

    // Should NOT contain made-up Apple revenue figures
    expect(lower).not.toMatch(/apple.{0,30}revenue.{0,30}\$\d/i);
  }, 120_000);
});
