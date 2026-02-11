/**
 * Story 5.3: LLM Judge — acceptance tests
 *
 * Tests:
 *   1. createJudge generates a prompt and saves to judge.md
 *   2. Judge prompt includes pass and fail criteria
 *   3. Judge agreement tested on held-out examples
 *   4. Rejects too few examples
 *   5. Rejects all-pass (no fail examples)
 *   6. Rejects all-fail (no pass examples)
 *   7. runJudge produces valid verdicts
 *   8. loadJudgePrompt reads saved prompt
 *   9. Real eval run → judge creation → agreement check
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
const IS_CI = !!process.env.CI;
import { existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createJudge, runJudge, loadJudgePrompt, type JudgeResult } from "../../src/eval/judge.js";
import { saveBenchmarkVersion } from "../../src/core/benchmark-version.js";
import { runEval, type EvalRun, type EvalResultEntry } from "../../src/eval/runner.js";
import type { QAPair } from "../../src/core/qa-generator.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const CORPUS_DIR = join(HOME, ".loop", "corpus");
const BENCHMARKS_DIR = join(HOME, ".loop", "benchmarks", "custom");
const RUNS_DIR = join(HOME, ".loop", "eval", "runs");
const EVAL_DIR = join(HOME, ".loop", "eval");
const JUDGE_PATH = join(EVAL_DIR, "judge.md");

// ── Helpers ──

function makeSyntheticRun(results: Partial<EvalResultEntry>[]): EvalRun {
  const full: EvalResultEntry[] = results.map((r, i) => ({
    id: r.id ?? `q${i + 1}`,
    question: r.question ?? `Question ${i + 1}?`,
    expectedAnswer: r.expectedAnswer ?? `Answer ${i + 1}`,
    actualAnswer: r.actualAnswer ?? `Actual ${i + 1}`,
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
      elapsed: 10000,
    },
  };
}

/** Generate a mix of obvious pass and fail examples for the judge to learn from */
function makeTrainingRun(): EvalRun {
  const results: Partial<EvalResultEntry>[] = [
    // Clear passes — correct answers
    { question: "What type is MSN 4521?", expectedAnswer: "B777-300ER", actualAnswer: "MSN 4521 is a Boeing 777-300ER [fleet_sample.xlsx]", pass: true, reason: "Correct aircraft type" },
    { question: "Who is the lessee for MSN 4521?", expectedAnswer: "Emirates", actualAnswer: "Emirates Airlines is the lessee [sample_lease.pdf, Page 1]", pass: true, reason: "Correct lessee" },
    { question: "What is the lease term?", expectedAnswer: "12 years", actualAnswer: "The lease term is twelve (12) years from March 2021 [sample_lease.pdf, Page 2]", pass: true, reason: "Correct lease term" },
    { question: "What is the monthly rent?", expectedAnswer: "$385,000", actualAnswer: "Monthly rent is $385,000 per month [fleet_sample.xlsx]", pass: true, reason: "Correct rent amount" },
    { question: "What is the delivery date?", expectedAnswer: "March 15, 2021", actualAnswer: "MSN 4521 was delivered on 2021-03-15 [sample_lease.pdf, Page 1]", pass: true, reason: "Correct date" },
    { question: "What is MSN 4522 status?", expectedAnswer: "Active", actualAnswer: "MSN 4522 is listed as Active [fleet_sample.xlsx]", pass: true, reason: "Correct status" },
    { question: "Is MSN 4521 in storage?", expectedAnswer: "Yes, in storage", actualAnswer: "Yes, MSN 4521 is In Storage with zero flight hours in January [utilization_sample.csv]", pass: true, reason: "Correct storage status" },

    // Clear fails — wrong answers
    { question: "What type is MSN 4521?", expectedAnswer: "B777-300ER", actualAnswer: "MSN 4521 is an Airbus A380", pass: false, reason: "Wrong aircraft type — A380 vs B777-300ER" },
    { question: "What is the engine reserve rate?", expectedAnswer: "$420/FH per amendment", actualAnswer: "$350 per flight hour for engine reserves [fleet_sample.xlsx]", pass: false, reason: "Wrong value — used original $350, amendment changed to $420" },
    { question: "What is the lease end date?", expectedAnswer: "March 2033", actualAnswer: "I don't know — the documents don't contain this information", pass: false, reason: "Said don't know but answer is in the lease" },
    { question: "How many aircraft are in storage?", expectedAnswer: "1 aircraft (MSN 4521)", actualAnswer: "There are 3 aircraft in storage", pass: false, reason: "Wrong count — only 1 is in storage" },
    { question: "What is the APU reserve rate?", expectedAnswer: "$95/FH", actualAnswer: "$180 per flight hour for APU reserves", pass: false, reason: "Wrong value — $180 is airframe, APU is $95" },
    { question: "What currency are reserves in?", expectedAnswer: "USD", actualAnswer: "Maintenance reserves are quoted in EUR", pass: false, reason: "Wrong currency — documents show USD not EUR" },
  ];

  return makeSyntheticRun(results);
}

// ── Tests ──

describe("Story 5.3: LLM Judge", () => {
  beforeEach(() => {
    if (existsSync(JUDGE_PATH)) rmSync(JUDGE_PATH);
  });

  afterAll(() => {
    if (existsSync(JUDGE_PATH)) rmSync(JUDGE_PATH);
  });

  test("rejects too few examples", async () => {
    const run = makeSyntheticRun([
      { pass: true, question: "Q1?", actualAnswer: "A1" },
      { pass: false, question: "Q2?", actualAnswer: "A2" },
    ]);

    await expect(createJudge(run, 10)).rejects.toThrow(/at least 10/);
  });

  test("rejects all-pass (no fail examples)", async () => {
    const results = Array.from({ length: 15 }, (_, i) => ({
      pass: true,
      question: `Question ${i}?`,
      actualAnswer: `Answer ${i}`,
    }));
    const run = makeSyntheticRun(results);

    await expect(createJudge(run, 10)).rejects.toThrow(/FAIL examples/);
  });

  test("rejects all-fail (no pass examples)", async () => {
    const results = Array.from({ length: 15 }, (_, i) => ({
      pass: false,
      question: `Question ${i}?`,
      actualAnswer: `Answer ${i}`,
    }));
    const run = makeSyntheticRun(results);

    await expect(createJudge(run, 10)).rejects.toThrow(/PASS examples/);
  });

  test.skipIf(IS_CI)("createJudge generates prompt and saves to judge.md", async () => {
    const run = makeTrainingRun();
    const result = await createJudge(run, 10);

    // Judge prompt saved
    expect(existsSync(JUDGE_PATH)).toBe(true);
    expect(result.judgePath).toBe(JUDGE_PATH);
    expect(result.judgePrompt.length).toBeGreaterThan(100);

    // Train/test split
    expect(result.trainCount).toBeGreaterThan(0);
    expect(result.testCount).toBeGreaterThan(0);
    expect(result.trainCount + result.testCount).toBe(13);

    // Agreement calculated
    expect(result.agreement).toBeGreaterThanOrEqual(0);
    expect(result.agreement).toBeLessThanOrEqual(1);

    // Test details exist
    expect(result.testDetails.length).toBe(result.testCount);
    for (const d of result.testDetails) {
      expect(typeof d.judgeLabel).toBe("boolean");
      expect(d.judgeReason).toBeTruthy();
      expect(typeof d.agree).toBe("boolean");
    }
  }, 120_000);

  test.skipIf(IS_CI)("judge prompt contains pass and fail criteria", async () => {
    const run = makeTrainingRun();
    const result = await createJudge(run, 10);

    const prompt = result.judgePrompt.toLowerCase();

    // Should mention pass and fail concepts
    expect(prompt).toMatch(/pass/i);
    expect(prompt).toMatch(/fail/i);
  }, 120_000);

  test.skipIf(IS_CI)("loadJudgePrompt reads saved prompt", async () => {
    const run = makeTrainingRun();
    await createJudge(run, 10);

    const loaded = loadJudgePrompt();
    expect(loaded).not.toBeNull();
    expect(loaded!.length).toBeGreaterThan(100);
  }, 120_000);

  test.skipIf(IS_CI)("runJudge produces valid verdict on correct answer", async () => {
    const run = makeTrainingRun();
    const result = await createJudge(run, 10);

    const verdict = await runJudge(
      result.judgePrompt,
      "What type is MSN 4521?",
      "MSN 4521 is a Boeing 777-300ER [fleet_sample.xlsx]",
    );

    expect(typeof verdict.pass).toBe("boolean");
    expect(verdict.reason).toBeTruthy();
    // This should likely pass — correct answer with citation
    expect(verdict.pass).toBe(true);
  }, 60_000);

  test.skipIf(IS_CI)("runJudge produces valid verdict on wrong answer", async () => {
    const run = makeTrainingRun();
    const result = await createJudge(run, 10);

    const verdict = await runJudge(
      result.judgePrompt,
      "What type is MSN 4521?",
      "MSN 4521 is an Airbus A380",
    );

    expect(typeof verdict.pass).toBe("boolean");
    expect(verdict.reason).toBeTruthy();
    // This should fail — wrong aircraft type
    expect(verdict.pass).toBe(false);
  }, 60_000);
});

// ── Real LLM eval → judge test ──

describe("Story 5.3: Real eval → judge", () => {
  beforeAll(async () => {
    if (existsSync(BENCHMARKS_DIR)) rmSync(BENCHMARKS_DIR, { recursive: true });
    if (existsSync(RUNS_DIR)) rmSync(RUNS_DIR, { recursive: true });
    if (existsSync(JUDGE_PATH)) rmSync(JUDGE_PATH);
    if (existsSync(CORPUS_DIR)) rmSync(CORPUS_DIR, { recursive: true });
    execSync("npx tsx src/index.ts ingest fixtures/", { stdio: "pipe" });
  }, 120_000);

  afterAll(() => {
    if (existsSync(BENCHMARKS_DIR)) rmSync(BENCHMARKS_DIR, { recursive: true });
    if (existsSync(RUNS_DIR)) rmSync(RUNS_DIR, { recursive: true });
    if (existsSync(JUDGE_PATH)) rmSync(JUDGE_PATH);
  });

  test.skipIf(IS_CI)("real eval run produces judge with measurable agreement", async () => {
    // Create a benchmark with diverse pairs including some that will fail
    const pairs: QAPair[] = [
      { id: "j1", question: "What type of aircraft is MSN 4521?", expectedAnswer: "B777-300ER", source: "fleet_sample.xlsx", dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "excel" }, status: "keep" },
      { id: "j2", question: "Who is the lessee for MSN 4521?", expectedAnswer: "Emirates", source: "sample_lease.pdf", dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "pdf" }, status: "keep" },
      { id: "j3", question: "What is the engine reserve per the amendment?", expectedAnswer: "$420 per flight hour", source: "sample_amendment.pdf", dimensions: { questionType: "numerical", difficulty: "cross-document", sourceFormat: "cross-format" }, status: "keep" },
      { id: "j4", question: "Which aircraft had zero flight hours?", expectedAnswer: "MSN 4521, in storage", source: "utilization_sample.csv", dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "csv" }, status: "keep" },
      { id: "j5", question: "What is the monthly rent for MSN 4521?", expectedAnswer: "$385,000", source: "fleet_sample.xlsx", dimensions: { questionType: "numerical", difficulty: "surface", sourceFormat: "excel" }, status: "keep" },
      { id: "j6", question: "What is the current insurance deductible?", expectedAnswer: "Not in the documents", source: "none", dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "pdf", edgeCase: "not_answerable" }, status: "keep" },
      { id: "j7", question: "What is the lease term for MSN 4521?", expectedAnswer: "12 years", source: "sample_lease.pdf", dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "pdf" }, status: "keep" },
      { id: "j8", question: "How many sheets are in the fleet spreadsheet?", expectedAnswer: "3 sheets", source: "fleet_sample.xlsx", dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "excel" }, status: "keep" },
      { id: "j9", question: "What is the APU reserve rate for MSN 4521?", expectedAnswer: "$95 per flight hour", source: "fleet_sample.xlsx", dimensions: { questionType: "numerical", difficulty: "buried", sourceFormat: "excel" }, status: "keep" },
      { id: "j10", question: "What is the airframe reserve rate for MSN 6103?", expectedAnswer: "$210 per flight hour", source: "fleet_sample.xlsx", dimensions: { questionType: "numerical", difficulty: "buried", sourceFormat: "excel" }, status: "keep" },
    ];

    saveBenchmarkVersion(pairs, "judge test");
    const run = await runEval("custom");

    // Create judge from eval results (lower minimum for test)
    const result = await createJudge(run, 5);

    // Basics
    expect(result.judgePrompt.length).toBeGreaterThan(100);
    expect(result.trainCount).toBeGreaterThan(0);
    expect(result.testCount).toBeGreaterThan(0);
    expect(result.agreement).toBeGreaterThanOrEqual(0);
    expect(result.agreement).toBeLessThanOrEqual(1);

    // Judge saved
    expect(existsSync(JUDGE_PATH)).toBe(true);
  }, 300_000);
});
