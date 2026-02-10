import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";

describe("Story 1.2: Python PDF parser", () => {
  const pdf = "dataset/BESTBUY_2023_10K.pdf";
  const outFile = "dataset/BESTBUY_2023_10K_parsed.txt";

  it("extracts text with page markers to stdout", () => {
    const output = execSync(`python python/parse_pdf.py ${pdf}`, {
      encoding: "utf-8",
    });
    expect(output).toContain("--- PAGE 1 ---");
    expect(output).toContain("--- PAGE 75 ---");
  });

  it("extracts real content from the PDF", () => {
    const output = execSync(`python python/parse_pdf.py ${pdf}`, {
      encoding: "utf-8",
    });
    expect(output).toMatch(/Best Buy/i);
  });

  it("supports --output flag", () => {
    execSync(`python python/parse_pdf.py ${pdf} --output ${outFile}`);
    expect(existsSync(outFile)).toBe(true);

    const text = readFileSync(outFile, "utf-8");
    expect(text).toContain("--- PAGE 1 ---");
    expect(text.match(/--- PAGE/g)!.length).toBe(75);
  });

  it("exits non-zero on missing file", () => {
    try {
      execSync("python python/parse_pdf.py nonexistent.pdf", {
        encoding: "utf-8",
        stdio: "pipe",
      });
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.status).not.toBe(0);
      expect(e.stderr.toString()).toContain("Error");
    }
  });
});
