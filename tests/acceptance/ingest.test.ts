import { describe, it, expect, beforeAll } from "vitest";
import { execSync, ExecSyncOptionsWithStringEncoding } from "child_process";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";

const CORPUS_DIR = join(
  process.env.HOME ?? process.env.USERPROFILE ?? "~",
  ".loop",
  "corpus"
);
const PDF = "dataset/BESTBUY_2023_10K.pdf";
const opts: ExecSyncOptionsWithStringEncoding = { encoding: "utf-8" };

describe("Story 1.6: loop ingest CLI", () => {
  beforeAll(() => {
    rmSync(join(process.env.HOME ?? process.env.USERPROFILE ?? "~", ".loop"), {
      recursive: true,
      force: true,
    });
  });

  it("ingests a PDF and shows progress", () => {
    const out = execSync(`npx tsx src/index.ts ingest ${PDF}`, opts);
    expect(out).toContain("Parsing:");
    expect(out).toContain("Pages: 75");
    expect(out).toContain("Stored: BESTBUY_2023_10K.txt");
    expect(out).toContain("Corpus: 1 document");
  });

  it("creates parsed text in corpus", () => {
    expect(existsSync(join(CORPUS_DIR, "BESTBUY_2023_10K.txt"))).toBe(true);

    const text = readFileSync(join(CORPUS_DIR, "BESTBUY_2023_10K.txt"), "utf-8");
    expect(text).toContain("--- PAGE 1 ---");
    expect(text).toMatch(/Best Buy/i);
  });

  it("creates INDEX.md in corpus", () => {
    const index = readFileSync(join(CORPUS_DIR, "INDEX.md"), "utf-8");
    expect(index).toContain("1 document");
    expect(index).toContain("BESTBUY_2023_10K.txt");
  });

  it("exits 1 on missing file", () => {
    try {
      execSync("npx tsx src/index.ts ingest nonexistent.pdf", {
        ...opts,
        stdio: "pipe",
      });
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.status).not.toBe(0);
    }
  });

  it("exits 1 on unsupported format", () => {
    try {
      execSync("npx tsx src/index.ts ingest package.json", {
        ...opts,
        stdio: "pipe",
      });
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.status).not.toBe(0);
    }
  });
});
