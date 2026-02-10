import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync, mkdirSync, rmSync } from "fs";
import { parseCsv } from "../../src/parsers/csv.js";

const TEST_DIR = "tmp/test-csv";
const CSV = "fixtures/utilization_sample.csv";

describe("Story 2.2: CSV parser", () => {
  beforeAll(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  const outFile = `${TEST_DIR}/util.txt`;

  it("returns correct ParseResult", async () => {
    const result = await parseCsv(CSV, outFile);

    expect(result.format).toBe("csv");
    expect(result.source).toBe("utilization_sample.csv");
    expect(result.rows).toBe(10);
  });

  it("creates output file with pipe-delimited data", () => {
    expect(existsSync(outFile)).toBe(true);

    const text = readFileSync(outFile, "utf-8");

    // Headers
    expect(text).toContain("MSN | Type");
    expect(text).toContain("Status");

    // Data
    expect(text).toContain("MSN 4521");
    expect(text).toContain("In Storage");
    expect(text).toContain("B777-300ER");
  });

  it("handles empty cells without crashing", () => {
    const text = readFileSync(outFile, "utf-8");
    // MSN 4522 has an empty Notes field — should not crash
    expect(text).toContain("MSN 4522");
  });

  it("throws on missing file", async () => {
    await expect(
      parseCsv("nonexistent.csv", "/tmp/out.txt")
    ).rejects.toThrow("File not found");
  });
});
