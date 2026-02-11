/**
 * Story 5.5: The Curve — eval history acceptance tests
 *
 * Tests:
 *   1. Empty history shows helpful message
 *   2. Single run shows baseline
 *   3. Multiple runs show improvement delta
 *   4. History entries have correct structure
 *   5. formatHistory includes bar chart and percentages
 *   6. Improvement notes appear in history
 *   7. Real eval runs produce valid history
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { existsSync, rmSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { loadHistory, formatHistory } from "../../src/eval/history.js";
import { saveBenchmarkVersion } from "../../src/core/benchmark-version.js";
import { runEval } from "../../src/eval/runner.js";
import type { QAPair } from "../../src/core/qa-generator.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const CORPUS_DIR = join(HOME, ".loop", "corpus");
const BENCHMARKS_DIR = join(HOME, ".loop", "benchmarks", "custom");
const RUNS_DIR = join(HOME, ".loop", "eval", "runs");
const EVAL_DIR = join(HOME, ".loop", "eval");
const IMPROVEMENTS_PATH = join(EVAL_DIR, "improvements.jsonl");

function cleanRuns(): void {
  if (existsSync(RUNS_DIR)) rmSync(RUNS_DIR, { recursive: true });
  if (existsSync(IMPROVEMENTS_PATH)) rmSync(IMPROVEMENTS_PATH);
}

/** Write a synthetic run JSONL for testing history without LLM */
function writeSyntheticRun(
  id: string,
  opts: { benchmark: string; version: string; accuracy: number; total: number; pass: number; fail: number; startTime: string; promptHash?: string },
): void {
  if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });
  const filepath = join(RUNS_DIR, `${id}.jsonl`);
  const meta = JSON.stringify({ type: "meta", benchmark: opts.benchmark, version: opts.version, startTime: opts.startTime, systemPromptHash: opts.promptHash ?? "abc123", pairCount: opts.total });
  const summary = JSON.stringify({ type: "summary", total: opts.total, pass: opts.pass, fail: opts.fail, accuracy: opts.accuracy, elapsed: 30000 });
  writeFileSync(filepath, meta + "\n" + summary + "\n", "utf-8");
}

// ── Pure tests ──

describe("Story 5.5: The Curve", () => {
  beforeEach(() => cleanRuns());
  afterAll(() => cleanRuns());

  test("empty history shows helpful message", () => {
    const history = loadHistory();
    expect(history.entries.length).toBe(0);
    expect(history.firstAccuracy).toBeNull();
    expect(history.delta).toBeNull();

    const formatted = formatHistory(history);
    expect(formatted).toContain("No eval runs yet");
  });

  test("single run shows baseline", () => {
    writeSyntheticRun("custom-2026-02-11T07-00-00Z", {
      benchmark: "custom", version: "v1", accuracy: 0.65, total: 50, pass: 32, fail: 18, startTime: "2026-02-11T07:00:00Z",
    });

    const history = loadHistory();
    expect(history.entries.length).toBe(1);
    expect(history.firstAccuracy).toBeCloseTo(0.65);
    expect(history.lastAccuracy).toBeCloseTo(0.65);
    expect(history.delta).toBeCloseTo(0);

    const formatted = formatHistory(history);
    expect(formatted).toContain("Baseline: 65%");
    expect(formatted).toContain("THE CURVE");
  });

  test("multiple runs show improvement delta", () => {
    writeSyntheticRun("custom-2026-02-11T07-00-00Z", {
      benchmark: "custom", version: "v1", accuracy: 0.65, total: 50, pass: 32, fail: 18, startTime: "2026-02-11T07:00:00Z",
    });
    writeSyntheticRun("custom-2026-02-13T07-00-00Z", {
      benchmark: "custom", version: "v1", accuracy: 0.78, total: 50, pass: 39, fail: 11, startTime: "2026-02-13T07:00:00Z",
    });
    writeSyntheticRun("custom-2026-02-15T07-00-00Z", {
      benchmark: "custom", version: "v1", accuracy: 0.85, total: 50, pass: 42, fail: 8, startTime: "2026-02-15T07:00:00Z",
    });

    const history = loadHistory();
    expect(history.entries.length).toBe(3);
    expect(history.firstAccuracy).toBeCloseTo(0.65);
    expect(history.lastAccuracy).toBeCloseTo(0.85);
    expect(history.delta).toBeCloseTo(0.20);

    const formatted = formatHistory(history);
    expect(formatted).toContain("65% → 85%");
    expect(formatted).toContain("+20 points");
    expect(formatted).toContain("3 runs");
  });

  test("history entries have correct structure", () => {
    writeSyntheticRun("custom-2026-02-11T07-00-00Z", {
      benchmark: "custom", version: "v1", accuracy: 0.70, total: 10, pass: 7, fail: 3, startTime: "2026-02-11T07:00:00Z", promptHash: "xyz789",
    });

    const history = loadHistory();
    const entry = history.entries[0];

    expect(entry.date).toBe("2026-02-11");
    expect(entry.benchmark).toBe("custom");
    expect(entry.version).toBe("v1");
    expect(entry.accuracy).toBeCloseTo(0.70);
    expect(entry.total).toBe(10);
    expect(entry.pass).toBe(7);
    expect(entry.fail).toBe(3);
    expect(entry.promptHash).toBe("xyz789");
    expect(entry.runId).toContain("custom");
  });

  test("formatHistory includes bar chart and percentages", () => {
    writeSyntheticRun("custom-2026-02-11T07-00-00Z", {
      benchmark: "custom", version: "v1", accuracy: 0.80, total: 20, pass: 16, fail: 4, startTime: "2026-02-11T07:00:00Z",
    });

    const formatted = formatHistory(loadHistory());
    expect(formatted).toContain("█");
    expect(formatted).toContain("80%");
    expect(formatted).toContain("20 pairs");
    expect(formatted).toContain("THE CURVE");
    expect(formatted).toContain("─");
  });

  test("improvement notes appear in history", () => {
    // Write improvement log BEFORE the second run
    if (!existsSync(EVAL_DIR)) mkdirSync(EVAL_DIR, { recursive: true });
    const impLog = JSON.stringify({
      timestamp: "2026-02-12T10:00:00Z",
      runId: "run-1",
      targetDimension: "questionType",
      targetValue: "calculation",
      delta: "## Calculations\nShow work",
      beforeAccuracy: 0.4,
      afterAccuracy: 0.8,
      regressions: 0,
      applied: true,
    });
    writeFileSync(IMPROVEMENTS_PATH, impLog + "\n", "utf-8");

    // First run (before improvement)
    writeSyntheticRun("custom-2026-02-11T07-00-00Z", {
      benchmark: "custom", version: "v1", accuracy: 0.65, total: 50, pass: 32, fail: 18, startTime: "2026-02-11T07:00:00Z",
    });
    // Second run (after improvement — within 24h of improvement timestamp)
    writeSyntheticRun("custom-2026-02-12T12-00-00Z", {
      benchmark: "custom", version: "v1", accuracy: 0.78, total: 50, pass: 39, fail: 11, startTime: "2026-02-12T12:00:00Z",
    });

    const history = loadHistory();
    expect(history.entries.length).toBe(2);

    // Second entry should have the improvement note
    expect(history.entries[1].note).toContain("calculation");

    const formatted = formatHistory(history);
    expect(formatted).toContain("fix: calculation");
  });

  test("filter by benchmark name", () => {
    writeSyntheticRun("custom-2026-02-11T07-00-00Z", {
      benchmark: "custom", version: "v1", accuracy: 0.65, total: 50, pass: 32, fail: 18, startTime: "2026-02-11T07:00:00Z",
    });
    writeSyntheticRun("financebench-2026-02-11T08-00-00Z", {
      benchmark: "financebench", version: "v1", accuracy: 0.45, total: 150, pass: 67, fail: 83, startTime: "2026-02-11T08:00:00Z",
    });

    const customOnly = loadHistory("custom");
    expect(customOnly.entries.length).toBe(1);
    expect(customOnly.entries[0].benchmark).toBe("custom");

    const all = loadHistory();
    expect(all.entries.length).toBe(2);
  });
});

// ── Real LLM test ──

describe("Story 5.5: Real eval runs → history", () => {
  beforeAll(async () => {
    cleanRuns();
    if (existsSync(BENCHMARKS_DIR)) rmSync(BENCHMARKS_DIR, { recursive: true });
    if (existsSync(CORPUS_DIR)) rmSync(CORPUS_DIR, { recursive: true });
    execSync("npx tsx src/index.ts ingest fixtures/", { stdio: "pipe" });
  }, 120_000);

  afterAll(() => {
    cleanRuns();
    if (existsSync(BENCHMARKS_DIR)) rmSync(BENCHMARKS_DIR, { recursive: true });
  });

  test("real eval runs produce valid history entries", async () => {
    const pairs: QAPair[] = [
      { id: "h1", question: "What type of aircraft is MSN 4521?", expectedAnswer: "B777-300ER", source: "fleet_sample.xlsx", dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "excel" }, status: "keep" },
      { id: "h2", question: "Who is the lessee?", expectedAnswer: "Emirates", source: "sample_lease.pdf", dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "pdf" }, status: "keep" },
    ];

    saveBenchmarkVersion(pairs, "history test");

    // Two runs
    await runEval("custom", { limit: 2 });
    await new Promise((r) => setTimeout(r, 200));
    await runEval("custom", { limit: 2 });

    const history = loadHistory();

    expect(history.entries.length).toBe(2);
    expect(history.firstAccuracy).not.toBeNull();
    expect(history.lastAccuracy).not.toBeNull();
    expect(history.delta).not.toBeNull();

    for (const entry of history.entries) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.accuracy).toBeGreaterThanOrEqual(0);
      expect(entry.accuracy).toBeLessThanOrEqual(1);
      expect(entry.total).toBe(2);
    }

    // Format works
    const formatted = formatHistory(history);
    expect(formatted).toContain("THE CURVE");
    expect(formatted).toContain("2 runs");
  }, 120_000);
});
