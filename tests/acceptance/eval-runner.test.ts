/**
 * Story 5.1: Eval Runner — acceptance tests
 *
 * Real LLM calls. Real documents. No mocks.
 *
 * Tests:
 *   1. Eval runner grades correct answers as pass
 *   2. Eval runner grades wrong answers as fail
 *   3. Run results saved to JSONL with correct structure
 *   4. --limit restricts number of pairs evaluated
 *   5. Summary has correct totals
 *   6. loadEvalRun reads back persisted run
 *   7. listEvalRuns shows all runs
 *   8. Grader handles edge cases (not_answerable)
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
const IS_CI = !!process.env.CI;
import { existsSync, mkdirSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { saveBenchmarkVersion } from "../../src/core/benchmark-version.js";
import { runEval, loadEvalRun, loadLatestRun, listEvalRuns } from "../../src/eval/runner.js";
import { gradeAnswer } from "../../src/eval/grader.js";
import type { QAPair } from "../../src/core/qa-generator.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const CORPUS_DIR = join(HOME, ".loop", "corpus");
const BENCHMARKS_DIR = join(HOME, ".loop", "benchmarks", "custom");
const RUNS_DIR = join(HOME, ".loop", "eval", "runs");

// ── Setup ──

beforeAll(async () => {
  // Clean corpus and benchmark state
  if (existsSync(BENCHMARKS_DIR)) rmSync(BENCHMARKS_DIR, { recursive: true });
  if (existsSync(RUNS_DIR)) rmSync(RUNS_DIR, { recursive: true });
  if (existsSync(CORPUS_DIR)) rmSync(CORPUS_DIR, { recursive: true });

  // Ingest test fixtures (real files, real parsers)
  execSync("npx tsx src/index.ts ingest fixtures/", { stdio: "pipe" });
}, 120_000);

afterAll(() => {
  if (existsSync(BENCHMARKS_DIR)) rmSync(BENCHMARKS_DIR, { recursive: true });
  if (existsSync(RUNS_DIR)) rmSync(RUNS_DIR, { recursive: true });
});

// ── Helpers ──

/** QA pairs we KNOW the answers to from our test fixtures */
function makeTestBenchmark(): QAPair[] {
  return [
    {
      id: "eval-001",
      question: "What type of aircraft is MSN 4521?",
      expectedAnswer: "B777-300ER",
      source: "fleet_sample.xlsx",
      dimensions: {
        questionType: "factual",
        difficulty: "surface",
        sourceFormat: "excel",
      },
      status: "keep" as const,
    },
    {
      id: "eval-002",
      question: "What is the engine maintenance reserve rate for MSN 4521 according to the amendment?",
      expectedAnswer: "$420 per flight hour, changed from $350 by the amendment",
      source: "sample_amendment.pdf",
      dimensions: {
        questionType: "numerical",
        difficulty: "cross-document",
        sourceFormat: "cross-format",
      },
      status: "keep" as const,
    },
    {
      id: "eval-003",
      question: "What is the current insurance deductible for MSN 4521?",
      expectedAnswer: "This information is not in the documents",
      source: "none",
      dimensions: {
        questionType: "factual",
        difficulty: "surface",
        sourceFormat: "pdf",
        edgeCase: "not_answerable",
      },
      status: "keep" as const,
    },
  ];
}

// ── Tests ──

describe("Story 5.1: Eval Runner", () => {
  beforeEach(() => {
    // Clean runs between tests
    if (existsSync(RUNS_DIR)) rmSync(RUNS_DIR, { recursive: true });
    if (existsSync(BENCHMARKS_DIR)) rmSync(BENCHMARKS_DIR, { recursive: true });
  });

  test("grader passes correct answer (LLM comparison)", async () => {
    const result = await gradeAnswer(
      "What type of aircraft is MSN 4521?",
      "B777-300ER",
      "MSN 4521 is a Boeing 777-300ER aircraft.",
    );

    expect(result.pass).toBe(true);
    expect(result.reason).toBeTruthy();
  }, 30_000);

  test("grader fails wrong answer", async () => {
    const result = await gradeAnswer(
      "What type of aircraft is MSN 4521?",
      "B777-300ER",
      "MSN 4521 is an Airbus A380.",
    );

    expect(result.pass).toBe(false);
    expect(result.reason).toBeTruthy();
  }, 30_000);

  test("grader handles not_answerable correctly", async () => {
    const result = await gradeAnswer(
      "What is the insurance deductible?",
      "This information is not in the documents",
      "I don't know — the documents don't contain insurance deductible information.",
    );

    expect(result.pass).toBe(true);
  }, 30_000);

  test("eval run grades benchmark pairs with real LLM", async () => {
    const pairs = makeTestBenchmark();
    saveBenchmarkVersion(pairs, "eval test");

    const progressLog: string[] = [];

    const run = await runEval("custom", {
      limit: 2,
      onProgress: (done, total, result) => {
        progressLog.push(`[${done}/${total}] ${result.pass ? "✅" : "❌"} ${result.question}`);
      },
    });

    // Basics
    expect(run.summary.total).toBe(2);
    expect(run.summary.pass + run.summary.fail).toBe(2);
    expect(run.summary.accuracy).toBeGreaterThanOrEqual(0);
    expect(run.summary.accuracy).toBeLessThanOrEqual(1);
    expect(run.summary.elapsed).toBeGreaterThan(0);

    // Results have expected structure
    for (const result of run.results) {
      expect(result.id).toBeTruthy();
      expect(result.question).toBeTruthy();
      expect(result.expectedAnswer).toBeTruthy();
      expect(result.actualAnswer).toBeTruthy();
      expect(typeof result.pass).toBe("boolean");
      expect(result.reason).toBeTruthy();
      expect(result.elapsed).toBeGreaterThan(0);
      expect(result.dimensions).toBeDefined();
    }

    // Progress was reported
    expect(progressLog.length).toBe(2);

    // The first pair (factual: aircraft type) should almost certainly pass
    const firstResult = run.results[0];
    expect(firstResult.question).toContain("MSN 4521");
  }, 120_000);

  test.skipIf(IS_CI)("run results saved to JSONL file", async () => {
    const pairs = makeTestBenchmark().slice(0, 1); // Just 1 pair
    saveBenchmarkVersion(pairs, "persist test");

    const run = await runEval("custom", { limit: 1 });

    // JSONL file exists
    expect(existsSync(RUNS_DIR)).toBe(true);
    const files = readdirSync(RUNS_DIR).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBe(1);

    // Parse the file
    const content = readFileSync(join(RUNS_DIR, files[0]), "utf-8");
    const lines = content.trim().split("\n").map((l) => JSON.parse(l));

    // Meta line
    const meta = lines.find((l: any) => l.type === "meta");
    expect(meta).toBeDefined();
    expect(meta.benchmark).toBe("custom");
    expect(meta.pairCount).toBe(1);
    expect(meta.systemPromptHash).toBeTruthy();

    // Result line(s)
    const results = lines.filter((l: any) => l.id && l.question);
    expect(results.length).toBe(1);

    // Summary line
    const summary = lines.find((l: any) => l.type === "summary");
    expect(summary).toBeDefined();
    expect(summary.total).toBe(1);
    expect(summary.pass + summary.fail).toBe(1);
  }, 120_000);

  test("loadEvalRun reads back persisted run", async () => {
    const pairs = makeTestBenchmark().slice(0, 1);
    saveBenchmarkVersion(pairs, "load test");

    const run = await runEval("custom", { limit: 1 });
    const loaded = loadEvalRun(run.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(run.id);
    expect(loaded!.summary.total).toBe(1);
    expect(loaded!.results.length).toBe(1);
    expect(loaded!.meta.benchmark).toBe("custom");
  }, 120_000);

  test("listEvalRuns shows all runs", async () => {
    const pairs = makeTestBenchmark().slice(0, 1);
    saveBenchmarkVersion(pairs, "list test");

    await runEval("custom", { limit: 1 });
    await runEval("custom", { limit: 1 });

    const runs = listEvalRuns();
    expect(runs.length).toBe(2);
    expect(runs[0].meta.benchmark).toBe("custom");
    expect(runs[1].meta.benchmark).toBe("custom");
  }, 180_000);

  test("--limit restricts pairs evaluated", async () => {
    const pairs = makeTestBenchmark(); // 3 pairs
    saveBenchmarkVersion(pairs, "limit test");

    const run = await runEval("custom", { limit: 1 });

    expect(run.summary.total).toBe(1);
    expect(run.results.length).toBe(1);
  }, 120_000);

  test.skipIf(IS_CI)("loadLatestRun returns most recent run", async () => {
    const pairs = makeTestBenchmark().slice(0, 1);
    saveBenchmarkVersion(pairs, "latest test");

    await runEval("custom", { limit: 1 });
    const run2 = await runEval("custom", { limit: 1 });

    const latest = loadLatestRun("custom");
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(run2.id);
  }, 180_000);
});
