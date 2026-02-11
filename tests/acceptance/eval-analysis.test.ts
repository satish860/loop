/**
 * Story 5.2: Error Analysis by Dimension — acceptance tests
 *
 * Tests the analyzer on real eval run data.
 * Grader tests use real LLM. Analyzer tests are pure computation (no LLM).
 *
 * Tests:
 *   1. Analysis slices by questionType
 *   2. Analysis slices by difficulty
 *   3. Analysis slices by sourceFormat
 *   4. Analysis identifies worst dimension
 *   5. Format output includes bar charts and warnings
 *   6. Handles all-pass run (no failures)
 *   7. Handles all-fail run
 *   8. Real eval run produces valid analysis
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { analyzeByDimension, formatAnalysis, type DimensionAnalysis } from "../../src/eval/analyzer.js";
import { saveBenchmarkVersion } from "../../src/core/benchmark-version.js";
import { runEval } from "../../src/eval/runner.js";
import type { EvalRun, EvalResultEntry, EvalRunMeta, EvalRunSummary } from "../../src/eval/runner.js";
import type { QAPair } from "../../src/core/qa-generator.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const CORPUS_DIR = join(HOME, ".loop", "corpus");
const BENCHMARKS_DIR = join(HOME, ".loop", "benchmarks", "custom");
const RUNS_DIR = join(HOME, ".loop", "eval", "runs");

// ── Helpers ──

/** Build a synthetic eval run for testing the analyzer (no LLM needed) */
function makeSyntheticRun(results: Partial<EvalResultEntry>[]): EvalRun {
  const full: EvalResultEntry[] = results.map((r, i) => ({
    id: r.id ?? `q${i + 1}`,
    question: r.question ?? `Question ${i + 1}?`,
    expectedAnswer: r.expectedAnswer ?? `Answer ${i + 1}`,
    actualAnswer: r.actualAnswer ?? `Answer ${i + 1}`,
    pass: r.pass ?? true,
    reason: r.reason ?? "ok",
    elapsed: r.elapsed ?? 1000,
    dimensions: r.dimensions ?? { questionType: "factual", difficulty: "surface", sourceFormat: "pdf" },
  }));

  const passCount = full.filter((r) => r.pass).length;

  return {
    id: "test-run",
    meta: {
      type: "meta",
      benchmark: "custom",
      version: "v1",
      startTime: new Date().toISOString(),
      systemPromptHash: "abc123",
      pairCount: full.length,
    },
    results: full,
    summary: {
      type: "summary",
      total: full.length,
      pass: passCount,
      fail: full.length - passCount,
      accuracy: full.length > 0 ? passCount / full.length : 0,
      elapsed: full.reduce((s, r) => s + r.elapsed, 0),
    },
  };
}

// ── Pure computation tests (no LLM) ──

describe("Story 5.2: Error Analysis by Dimension", () => {

  test("slices by questionType with correct accuracy per group", () => {
    const run = makeSyntheticRun([
      { pass: true,  dimensions: { questionType: "factual",     difficulty: "surface", sourceFormat: "pdf" } },
      { pass: true,  dimensions: { questionType: "factual",     difficulty: "surface", sourceFormat: "pdf" } },
      { pass: false, dimensions: { questionType: "numerical",   difficulty: "surface", sourceFormat: "excel" } },
      { pass: true,  dimensions: { questionType: "numerical",   difficulty: "surface", sourceFormat: "excel" } },
      { pass: false, dimensions: { questionType: "calculation", difficulty: "buried",  sourceFormat: "pdf" } },
      { pass: false, dimensions: { questionType: "calculation", difficulty: "buried",  sourceFormat: "pdf" } },
    ]);

    const analysis = analyzeByDimension(run);

    // factual: 2/2 = 100%
    expect(analysis.byQuestionType["factual"].total).toBe(2);
    expect(analysis.byQuestionType["factual"].accuracy).toBe(1.0);
    expect(analysis.byQuestionType["factual"].failures.length).toBe(0);

    // numerical: 1/2 = 50%
    expect(analysis.byQuestionType["numerical"].total).toBe(2);
    expect(analysis.byQuestionType["numerical"].accuracy).toBe(0.5);
    expect(analysis.byQuestionType["numerical"].failures.length).toBe(1);

    // calculation: 0/2 = 0%
    expect(analysis.byQuestionType["calculation"].total).toBe(2);
    expect(analysis.byQuestionType["calculation"].accuracy).toBe(0);
    expect(analysis.byQuestionType["calculation"].failures.length).toBe(2);
  });

  test("slices by difficulty", () => {
    const run = makeSyntheticRun([
      { pass: true,  dimensions: { questionType: "factual", difficulty: "surface",        sourceFormat: "pdf" } },
      { pass: true,  dimensions: { questionType: "factual", difficulty: "surface",        sourceFormat: "pdf" } },
      { pass: false, dimensions: { questionType: "factual", difficulty: "cross-document", sourceFormat: "pdf" } },
      { pass: false, dimensions: { questionType: "factual", difficulty: "cross-document", sourceFormat: "pdf" } },
    ]);

    const analysis = analyzeByDimension(run);

    expect(analysis.byDifficulty["surface"].accuracy).toBe(1.0);
    expect(analysis.byDifficulty["cross-document"].accuracy).toBe(0);
  });

  test("slices by sourceFormat", () => {
    const run = makeSyntheticRun([
      { pass: true,  dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "pdf" } },
      { pass: false, dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "excel" } },
      { pass: false, dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "csv" } },
      { pass: true,  dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "csv" } },
    ]);

    const analysis = analyzeByDimension(run);

    expect(analysis.bySourceFormat["pdf"].accuracy).toBe(1.0);
    expect(analysis.bySourceFormat["excel"].accuracy).toBe(0);
    expect(analysis.bySourceFormat["csv"].accuracy).toBe(0.5);
  });

  test("identifies worst dimension value", () => {
    const run = makeSyntheticRun([
      { pass: true,  dimensions: { questionType: "factual",     difficulty: "surface", sourceFormat: "pdf" } },
      { pass: true,  dimensions: { questionType: "factual",     difficulty: "surface", sourceFormat: "pdf" } },
      { pass: false, dimensions: { questionType: "calculation", difficulty: "buried",  sourceFormat: "excel" } },
      { pass: false, dimensions: { questionType: "calculation", difficulty: "buried",  sourceFormat: "excel" } },
      { pass: false, dimensions: { questionType: "calculation", difficulty: "buried",  sourceFormat: "csv" } },
    ]);

    const analysis = analyzeByDimension(run);

    expect(analysis.worst).not.toBeNull();
    // calculation: 0/3 = 0% is worst
    expect(analysis.worst!.value).toBe("calculation");
    expect(analysis.worst!.accuracy).toBe(0);
    expect(analysis.worst!.failures.length).toBe(3);
  });

  test("format output includes bar charts and warning markers", () => {
    const run = makeSyntheticRun([
      { pass: true,  dimensions: { questionType: "factual",     difficulty: "surface", sourceFormat: "pdf" } },
      { pass: true,  dimensions: { questionType: "factual",     difficulty: "surface", sourceFormat: "pdf" } },
      { pass: false, dimensions: { questionType: "calculation", difficulty: "buried",  sourceFormat: "pdf" } },
    ]);

    const analysis = analyzeByDimension(run);
    const output = formatAnalysis(analysis);

    // Has dimension headers
    expect(output).toContain("By Question Type:");
    expect(output).toContain("By Difficulty:");

    // Has bar chars
    expect(output).toContain("█");

    // Has percentage
    expect(output).toMatch(/100%/);
    expect(output).toMatch(/0%/);

    // Has warning for below 70%
    expect(output).toContain("⚠️");

    // Has worst callout
    expect(output).toContain("Worst:");
  });

  test("handles all-pass run gracefully", () => {
    const run = makeSyntheticRun([
      { pass: true, dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "pdf" } },
      { pass: true, dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "pdf" } },
    ]);

    const analysis = analyzeByDimension(run);

    expect(analysis.overall.accuracy).toBe(1.0);
    expect(analysis.overall.fail).toBe(0);
    // Worst should still exist (just high accuracy)
    expect(analysis.worst).not.toBeNull();
    expect(analysis.worst!.accuracy).toBe(1.0);

    // Format should work without errors
    const output = formatAnalysis(analysis);
    expect(output).toContain("100%");
  });

  test("handles all-fail run", () => {
    const run = makeSyntheticRun([
      { pass: false, reason: "wrong value", dimensions: { questionType: "numerical", difficulty: "buried", sourceFormat: "excel" } },
      { pass: false, reason: "hallucinated", dimensions: { questionType: "factual",  difficulty: "surface", sourceFormat: "pdf" } },
    ]);

    const analysis = analyzeByDimension(run);

    expect(analysis.overall.accuracy).toBe(0);
    expect(analysis.overall.fail).toBe(2);
    expect(analysis.worst).not.toBeNull();
    expect(analysis.worst!.accuracy).toBe(0);
    expect(analysis.worst!.failures.length).toBeGreaterThan(0);
  });

  test("overall accuracy matches run summary", () => {
    const run = makeSyntheticRun([
      { pass: true  },
      { pass: false },
      { pass: true  },
      { pass: true  },
      { pass: false },
    ]);

    const analysis = analyzeByDimension(run);

    expect(analysis.overall.total).toBe(5);
    expect(analysis.overall.pass).toBe(3);
    expect(analysis.overall.fail).toBe(2);
    expect(analysis.overall.accuracy).toBeCloseTo(0.6);
  });
});

// ── Real LLM test ──

describe("Story 5.2: Real eval → analysis", () => {
  beforeAll(async () => {
    if (existsSync(BENCHMARKS_DIR)) rmSync(BENCHMARKS_DIR, { recursive: true });
    if (existsSync(RUNS_DIR)) rmSync(RUNS_DIR, { recursive: true });
    if (existsSync(CORPUS_DIR)) rmSync(CORPUS_DIR, { recursive: true });
    execSync("npx tsx src/index.ts ingest fixtures/", { stdio: "pipe" });
  }, 120_000);

  afterAll(() => {
    if (existsSync(BENCHMARKS_DIR)) rmSync(BENCHMARKS_DIR, { recursive: true });
    if (existsSync(RUNS_DIR)) rmSync(RUNS_DIR, { recursive: true });
  });

  test("real eval run produces valid dimension analysis", async () => {
    const pairs: QAPair[] = [
      {
        id: "a1",
        question: "What type of aircraft is MSN 4521?",
        expectedAnswer: "B777-300ER",
        source: "fleet_sample.xlsx",
        dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "excel" },
        status: "keep",
      },
      {
        id: "a2",
        question: "Which aircraft had zero flight hours in January?",
        expectedAnswer: "MSN 4521, in storage",
        source: "utilization_sample.csv",
        dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "csv" },
        status: "keep",
      },
      {
        id: "a3",
        question: "What is the current insurance deductible for MSN 4521?",
        expectedAnswer: "Not in the documents",
        source: "none",
        dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "pdf", edgeCase: "not_answerable" },
        status: "keep",
      },
    ];

    saveBenchmarkVersion(pairs, "analysis test");
    const run = await runEval("custom", { limit: 3 });
    const analysis = analyzeByDimension(run);

    // Has all dimension groups
    expect(Object.keys(analysis.byQuestionType).length).toBeGreaterThan(0);
    expect(Object.keys(analysis.bySourceFormat).length).toBeGreaterThan(0);

    // Each slice has valid structure
    for (const [, slice] of Object.entries(analysis.byQuestionType)) {
      expect(slice.total).toBeGreaterThan(0);
      expect(slice.accuracy).toBeGreaterThanOrEqual(0);
      expect(slice.accuracy).toBeLessThanOrEqual(1);
      expect(slice.pass + slice.fail).toBe(slice.total);
    }

    // Overall matches
    expect(analysis.overall.total).toBe(3);
    expect(analysis.overall.pass + analysis.overall.fail).toBe(3);

    // Worst dimension exists
    expect(analysis.worst).not.toBeNull();

    // Format produces output
    const formatted = formatAnalysis(analysis);
    expect(formatted.length).toBeGreaterThan(50);
    expect(formatted).toContain("By Question Type:");
  }, 180_000);
});
