import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { execSync } from "child_process";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const LOOP_DIR = join(HOME, ".loop");
const CORPUS_DIR = join(LOOP_DIR, "corpus");

function run(cmd: string): string {
  return execSync(`npx tsx src/index.ts ${cmd}`, {
    encoding: "utf-8",
    timeout: 60_000,
  });
}

describe("Story 2.3: Ingest routes files to correct parser", () => {
  beforeAll(() => rmSync(LOOP_DIR, { recursive: true, force: true }));

  it("ingests PDF via PDF parser", () => {
    const out = run("ingest fixtures/sample_lease.pdf");
    expect(out).toContain("Parsing:");
    expect(existsSync(join(CORPUS_DIR, "sample_lease.txt"))).toBe(true);
  });

  it("ingests Excel via Excel parser", () => {
    const out = run("ingest fixtures/fleet_sample.xlsx");
    expect(out).toContain("Parsing:");
    expect(existsSync(join(CORPUS_DIR, "fleet_sample.txt"))).toBe(true);
  });

  it("ingests CSV via CSV parser", () => {
    const out = run("ingest fixtures/utilization_sample.csv");
    expect(out).toContain("Parsing:");
    expect(existsSync(join(CORPUS_DIR, "utilization_sample.txt"))).toBe(true);
  });

  it("rejects unsupported format", () => {
    try {
      execSync("npx tsx src/index.ts ingest package.json", {
        encoding: "utf-8",
        stdio: "pipe",
      });
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.status).not.toBe(0);
    }
  });

  it("INDEX.md lists all 3 documents with format info", () => {
    const index = readFileSync(join(CORPUS_DIR, "INDEX.md"), "utf-8");
    expect(index).toContain("3 documents");
    expect(index).toContain("sample_lease.txt");
    expect(index).toContain("fleet_sample.txt");
    expect(index).toContain("utilization_sample.txt");
    expect(index).toContain("PDF");
    expect(index).toContain("Excel");
    expect(index).toContain("CSV");
  });
});

describe("Story 2.4: Folder ingest", () => {
  beforeEach(() => rmSync(LOOP_DIR, { recursive: true, force: true }));

  it("ingests all supported files from a folder", () => {
    const out = run("ingest fixtures/");
    expect(out).toContain("files found");
    expect(out).toContain("✅");

    // All fixture files should be in corpus
    expect(existsSync(join(CORPUS_DIR, "sample_lease.txt"))).toBe(true);
    expect(existsSync(join(CORPUS_DIR, "sample_amendment.txt"))).toBe(true);
    expect(existsSync(join(CORPUS_DIR, "fleet_sample.txt"))).toBe(true);
    expect(existsSync(join(CORPUS_DIR, "utilization_sample.txt"))).toBe(true);
    expect(existsSync(join(CORPUS_DIR, "BESTBUY_2023_10K.txt"))).toBe(true);

    const index = readFileSync(join(CORPUS_DIR, "INDEX.md"), "utf-8");
    expect(index).toContain("5 documents");
  });
});

describe("Story 2.5: Incremental ingest", () => {
  beforeEach(() => rmSync(LOOP_DIR, { recursive: true, force: true }));

  it("skips already-ingested files on re-run", () => {
    // First ingest
    run("ingest fixtures/");

    // Second ingest — should skip everything
    const out = run("ingest fixtures/");
    expect(out).toContain("already ingested");
    expect(out).not.toContain("✅"); // no new files processed
  });

  it("skips already-ingested single file", () => {
    run("ingest fixtures/fleet_sample.xlsx");
    const out = run("ingest fixtures/fleet_sample.xlsx");
    expect(out.toLowerCase()).toContain("already ingested");
  });
});
