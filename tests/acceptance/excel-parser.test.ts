import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync, mkdirSync, rmSync } from "fs";
import { parseExcel } from "../../src/parsers/excel.js";

const TEST_DIR = "tmp/test-excel";
const XLSX = "fixtures/fleet_sample.xlsx";

describe("Story 2.1: Excel parser", () => {
  beforeAll(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  const outFile = `${TEST_DIR}/fleet.txt`;

  it("returns correct ParseResult", async () => {
    const result = await parseExcel(XLSX, outFile);

    expect(result.format).toBe("excel");
    expect(result.source).toBe("fleet_sample.xlsx");
    expect(result.sheets).toBe(3);
    expect(result.rows).toBeGreaterThanOrEqual(10);
  });

  it("creates output file with sheet markers", () => {
    expect(existsSync(outFile)).toBe(true);

    const text = readFileSync(outFile, "utf-8");
    expect(text).toContain('--- SHEET "Fleet Overview" ---');
    expect(text).toContain('--- SHEET "Maintenance Reserves" ---');
    expect(text).toContain('--- SHEET "Delivery Schedule" ---');
  });

  it("has pipe-delimited data with headers", () => {
    const text = readFileSync(outFile, "utf-8");

    // Headers present
    expect(text).toContain("MSN | Type | Lessee");
    expect(text).toContain("Engine $/FH");

    // Data present
    expect(text).toContain("MSN 4521");
    expect(text).toContain("B777-300ER");
    expect(text).toContain("Emirates");
    expect(text).toContain("$350");
  });

  it("throws on missing file", async () => {
    await expect(
      parseExcel("nonexistent.xlsx", "/tmp/out.txt")
    ).rejects.toThrow("File not found");
  });
});
