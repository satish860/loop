import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync, rmSync } from "fs";
import { parsePdf } from "../../src/parsers/pdf.js";

const TEST_DIR = "dataset/test-output";
const PDF = "dataset/BESTBUY_2023_10K.pdf";

describe("Story 1.3: Node.js PDF parser wrapper", () => {
  // Clean test output before each run
  const outFile = `${TEST_DIR}/bestbuy_parsed.txt`;

  it("parsePdf returns correct ParseResult", async () => {
    mkdirSync(TEST_DIR, { recursive: true });

    const result = await parsePdf(PDF, outFile);

    expect(result.format).toBe("pdf");
    expect(result.source).toBe("BESTBUY_2023_10K.pdf");
    expect(result.outputPath).toBe(outFile);
    expect(result.pages).toBe(75);
  });

  it("creates output .txt file with page markers", async () => {
    expect(existsSync(outFile)).toBe(true);

    const text = readFileSync(outFile, "utf-8");
    expect(text).toContain("--- PAGE 1 ---");
    expect(text).toContain("--- PAGE 75 ---");
    expect(text).toMatch(/Best Buy/i);
  });

  it("throws on missing file", async () => {
    await expect(
      parsePdf("nonexistent.pdf", "/tmp/out.txt")
    ).rejects.toThrow("File not found");
  });

  // Clean up
  it("cleanup", () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });
});
