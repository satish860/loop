import { describe, test, expect, beforeEach, afterAll } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  saveBenchmarkVersion,
  loadVersionedBenchmark,
  listBenchmarkVersions,
  getLatestVersion,
} from "../../src/core/benchmark-version.js";
import type { QAPair } from "../../src/core/qa-generator.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const BENCHMARKS_DIR = join(HOME, ".loop", "benchmarks", "custom");

function makePairs(count: number): QAPair[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `qa-${String(i + 1).padStart(3, "0")}`,
    question: `Question ${i + 1}?`,
    expectedAnswer: `Answer ${i + 1}`,
    source: "test.pdf",
    page: "Page 1",
    dimensions: {
      questionType: "factual",
      difficulty: "surface",
      sourceFormat: "pdf",
    },
    status: "keep" as const,
  }));
}

describe("Story 4.5: Benchmark versioning", () => {
  beforeEach(() => {
    // Clean all benchmark files
    if (existsSync(BENCHMARKS_DIR)) rmSync(BENCHMARKS_DIR, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(BENCHMARKS_DIR)) rmSync(BENCHMARKS_DIR, { recursive: true });
  });

  test("first save creates v1", () => {
    const meta = saveBenchmarkVersion(makePairs(5));

    expect(meta.version).toBe("v1");
    expect(meta.pairCount).toBe(5);
    expect(meta.timestamp).toBeTruthy();
    expect(meta.systemPromptHash).toBeTruthy();
    expect(meta.systemPromptHash.length).toBe(12);
  });

  test("second save creates v2, preserves v1", () => {
    saveBenchmarkVersion(makePairs(5));
    const meta2 = saveBenchmarkVersion(makePairs(8));

    expect(meta2.version).toBe("v2");
    expect(meta2.pairCount).toBe(8);

    // v1 file still exists
    expect(existsSync(join(BENCHMARKS_DIR, "qa-pairs-v1.jsonl"))).toBe(true);
    expect(existsSync(join(BENCHMARKS_DIR, "qa-pairs-v2.jsonl"))).toBe(true);
  });

  test("loadVersionedBenchmark() loads latest by default", () => {
    saveBenchmarkVersion(makePairs(5));
    saveBenchmarkVersion(makePairs(8));

    const latest = loadVersionedBenchmark();

    expect(latest).not.toBeNull();
    expect(latest!.version).toBe("v2");
    expect(latest!.pairs.length).toBe(8);
    expect(latest!.meta.pairCount).toBe(8);
  });

  test("loadVersionedBenchmark('v1') loads specific version", () => {
    saveBenchmarkVersion(makePairs(5));
    saveBenchmarkVersion(makePairs(8));

    const v1 = loadVersionedBenchmark("v1");

    expect(v1).not.toBeNull();
    expect(v1!.version).toBe("v1");
    expect(v1!.pairs.length).toBe(5);
  });

  test("listBenchmarkVersions returns all versions", () => {
    saveBenchmarkVersion(makePairs(5));
    saveBenchmarkVersion(makePairs(8));
    saveBenchmarkVersion(makePairs(12));

    const versions = listBenchmarkVersions();

    expect(versions.length).toBe(3);
    expect(versions[0].version).toBe("v1");
    expect(versions[1].version).toBe("v2");
    expect(versions[2].version).toBe("v3");
    expect(versions[0].pairCount).toBe(5);
    expect(versions[1].pairCount).toBe(8);
    expect(versions[2].pairCount).toBe(12);
  });

  test("getLatestVersion returns latest", () => {
    expect(getLatestVersion()).toBeNull();

    saveBenchmarkVersion(makePairs(5));
    expect(getLatestVersion()).toBe("v1");

    saveBenchmarkVersion(makePairs(8));
    expect(getLatestVersion()).toBe("v2");
  });

  test("qa-pairs.jsonl always reflects latest version", () => {
    saveBenchmarkVersion(makePairs(5));
    let latest = readFileSync(join(BENCHMARKS_DIR, "qa-pairs.jsonl"), "utf-8").trim().split("\n");
    expect(latest.length).toBe(5);

    saveBenchmarkVersion(makePairs(8));
    latest = readFileSync(join(BENCHMARKS_DIR, "qa-pairs.jsonl"), "utf-8").trim().split("\n");
    expect(latest.length).toBe(8);
  });

  test("versions.json manifest is maintained", () => {
    saveBenchmarkVersion(makePairs(5));
    saveBenchmarkVersion(makePairs(8));

    const manifest = JSON.parse(
      readFileSync(join(BENCHMARKS_DIR, "versions.json"), "utf-8")
    );

    expect(manifest.latest).toBe("v2");
    expect(manifest.versions.length).toBe(2);
    expect(manifest.versions[0].version).toBe("v1");
    expect(manifest.versions[1].version).toBe("v2");
  });

  test("loadVersionedBenchmark returns null for nonexistent version", () => {
    saveBenchmarkVersion(makePairs(5));
    expect(loadVersionedBenchmark("v99")).toBeNull();
  });

  test("version records corpus doc count", () => {
    const meta = saveBenchmarkVersion(makePairs(5));
    // corpusDocCount reflects whatever is in the corpus at save time
    expect(typeof meta.corpusDocCount).toBe("number");
    expect(meta.corpusDocCount).toBeGreaterThanOrEqual(0);
  });

  test("description is optional and stored", () => {
    const meta = saveBenchmarkVersion(makePairs(5), "baseline benchmark");

    expect(meta.description).toBe("baseline benchmark");

    const loaded = loadVersionedBenchmark("v1");
    expect(loaded!.meta.description).toBe("baseline benchmark");
  });
});
