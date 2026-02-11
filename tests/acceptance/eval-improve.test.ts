/**
 * Story 5.4: System Prompt Improvement — acceptance tests
 *
 * Tests:
 *   1. suggestImprovement identifies worst dimension and proposes delta
 *   2. Proposed delta is an addition (not a full rewrite)
 *   3. Tests on failed queries show before/after
 *   4. Regression check on passing queries
 *   5. applyImprovement saves to system.md and logs
 *   6. buildSystemPrompt reads custom file after apply
 *   7. Rejects run with no failures
 *   8. Real eval → improve → delta addresses failures
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
const IS_CI = !!process.env.CI;
import { existsSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  suggestImprovement,
  applyImprovement,
  loadImprovements,
  getCurrentSystemPrompt,
  type Improvement,
} from "../../src/eval/improver.js";
import { buildSystemPrompt, getDefaultSystemPrompt } from "../../src/core/session.js";
import { saveBenchmarkVersion } from "../../src/core/benchmark-version.js";
import { runEval, type EvalRun, type EvalResultEntry } from "../../src/eval/runner.js";
import type { QAPair } from "../../src/core/qa-generator.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const CORPUS_DIR = join(HOME, ".loop", "corpus");
const BENCHMARKS_DIR = join(HOME, ".loop", "benchmarks", "custom");
const RUNS_DIR = join(HOME, ".loop", "eval", "runs");
const EVAL_DIR = join(HOME, ".loop", "eval");
const SYSTEM_PROMPT_PATH = join(HOME, ".loop", "system.md");
const IMPROVEMENTS_PATH = join(EVAL_DIR, "improvements.jsonl");

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
    meta: { type: "meta", benchmark: "custom", version: "v1", startTime: new Date().toISOString(), systemPromptHash: "abc123", pairCount: full.length },
    results: full,
    summary: { type: "summary", total: full.length, pass: passCount, fail: full.length - passCount, accuracy: passCount / full.length, elapsed: 10000 },
  };
}

function cleanupFiles(): void {
  if (existsSync(SYSTEM_PROMPT_PATH)) rmSync(SYSTEM_PROMPT_PATH);
  if (existsSync(IMPROVEMENTS_PATH)) rmSync(IMPROVEMENTS_PATH);
  if (existsSync(join(EVAL_DIR, "pending-improvement.json"))) rmSync(join(EVAL_DIR, "pending-improvement.json"));
}

// ── Tests ──

describe("Story 5.4: System Prompt Improvement", () => {
  beforeEach(() => {
    cleanupFiles();
  });

  afterAll(() => {
    cleanupFiles();
  });

  test("rejects run with no failures", async () => {
    const run = makeSyntheticRun([
      { pass: true },
      { pass: true },
    ]);

    await expect(suggestImprovement(run)).rejects.toThrow(/No failures/);
  });

  test("applyImprovement saves to system.md and logs", () => {
    const improvement: Improvement = {
      targetDimension: "questionType",
      targetValue: "calculation",
      reflections: "System doesn't perform calculations",
      proposedDelta: "## Calculations\nWhen asked to calculate, show step-by-step work.",
      beforeAccuracy: 0,
      afterAccuracy: 1,
      failuresBefore: 2,
      failuresAfter: 0,
      regressions: [],
      passTestResults: [],
      failTestResults: [],
    };

    applyImprovement(improvement, "test-run-123");

    // system.md exists and contains the delta
    expect(existsSync(SYSTEM_PROMPT_PATH)).toBe(true);
    const savedPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
    expect(savedPrompt).toContain("## Calculations");
    expect(savedPrompt).toContain("step-by-step");

    // Also contains the original base prompt
    expect(savedPrompt).toContain("document intelligence assistant");

    // Improvement logged
    const logs = loadImprovements();
    expect(logs.length).toBe(1);
    expect(logs[0].runId).toBe("test-run-123");
    expect(logs[0].targetValue).toBe("calculation");
    expect(logs[0].applied).toBe(true);
  });

  test("buildSystemPrompt reads custom file after apply", () => {
    // Before apply — returns default
    const before = buildSystemPrompt();
    expect(before).toContain("document intelligence assistant");
    expect(before).not.toContain("CUSTOM ADDITION");

    // Write custom system prompt
    const customPrompt = before + "\n\n## CUSTOM ADDITION\nTest rule.";
    if (!existsSync(join(HOME, ".loop"))) mkdirSync(join(HOME, ".loop"), { recursive: true });
    writeFileSync(SYSTEM_PROMPT_PATH, customPrompt, "utf-8");

    // After — reads from file
    const after = buildSystemPrompt();
    expect(after).toContain("CUSTOM ADDITION");
    expect(after).toContain("document intelligence assistant");
  });

  test("getDefaultSystemPrompt ignores custom file", () => {
    writeFileSync(SYSTEM_PROMPT_PATH, "totally custom prompt", "utf-8");

    const defaultPrompt = getDefaultSystemPrompt();
    expect(defaultPrompt).toContain("document intelligence assistant");
    expect(defaultPrompt).not.toContain("totally custom");
  });

  test("loadImprovements returns empty array when no history", () => {
    expect(loadImprovements()).toEqual([]);
  });
});

// ── Real LLM tests ──

describe("Story 5.4: Real eval → improve", () => {
  beforeAll(async () => {
    cleanupFiles();
    if (existsSync(BENCHMARKS_DIR)) rmSync(BENCHMARKS_DIR, { recursive: true });
    if (existsSync(RUNS_DIR)) rmSync(RUNS_DIR, { recursive: true });
    if (existsSync(CORPUS_DIR)) rmSync(CORPUS_DIR, { recursive: true });
    execSync("npx tsx src/index.ts ingest fixtures/", { stdio: "pipe" });
  }, 120_000);

  afterAll(() => {
    cleanupFiles();
    if (existsSync(BENCHMARKS_DIR)) rmSync(BENCHMARKS_DIR, { recursive: true });
    if (existsSync(RUNS_DIR)) rmSync(RUNS_DIR, { recursive: true });
  });

  test.skipIf(IS_CI)("suggestImprovement produces delta with before/after and regression check", async () => {
    // Create benchmark with a mix — include pairs with wrong expected answers to force failures
    // This simulates having a benchmark where the system gets some wrong
    const pairs: QAPair[] = [
      { id: "i1", question: "What type of aircraft is MSN 4521?", expectedAnswer: "B777-300ER", source: "fleet_sample.xlsx", dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "excel" }, status: "keep" },
      { id: "i2", question: "Who is the lessee for MSN 4521?", expectedAnswer: "Emirates", source: "sample_lease.pdf", dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "pdf" }, status: "keep" },
      // Deliberately wrong expected answer — will force a "fail" grade to test the improver
      { id: "i3", question: "What is the monthly rent for MSN 4521?", expectedAnswer: "$999,999 per month", source: "fleet_sample.xlsx", dimensions: { questionType: "numerical", difficulty: "surface", sourceFormat: "excel" }, status: "keep" },
      // Another forced fail — expects a specific format the system won't match
      { id: "i4", question: "List all aircraft MSNs in the fleet spreadsheet in reverse numerical order, comma separated", expectedAnswer: "MSN 9999, MSN 8888, MSN 7777", source: "fleet_sample.xlsx", dimensions: { questionType: "comparison", difficulty: "buried", sourceFormat: "excel" }, status: "keep" },
    ];

    saveBenchmarkVersion(pairs, "improve test");

    // Run eval
    const run = await runEval("custom");

    // Suggest improvement
    const progressSteps: string[] = [];
    const improvement = await suggestImprovement(run, (step) => {
      progressSteps.push(step);
    });

    // Core structure
    expect(improvement.targetDimension).toBeTruthy();
    expect(improvement.targetValue).toBeTruthy();
    expect(improvement.reflections).toBeTruthy();
    expect(improvement.reflections.length).toBeGreaterThan(20);
    expect(improvement.proposedDelta).toBeTruthy();
    expect(improvement.proposedDelta.length).toBeGreaterThan(10);

    // Before/after accuracy
    expect(improvement.beforeAccuracy).toBeGreaterThanOrEqual(0);
    expect(improvement.beforeAccuracy).toBeLessThanOrEqual(1);
    expect(improvement.afterAccuracy).toBeGreaterThanOrEqual(0);
    expect(improvement.afterAccuracy).toBeLessThanOrEqual(1);

    // Test results exist
    expect(improvement.failTestResults.length).toBeGreaterThan(0);
    for (const r of improvement.failTestResults) {
      expect(typeof r.pass).toBe("boolean");
      expect(r.question).toBeTruthy();
    }

    // Regressions array exists (may be empty)
    expect(Array.isArray(improvement.regressions)).toBe(true);

    // Progress was reported
    expect(progressSteps.length).toBeGreaterThanOrEqual(3);

    // Delta is an addition, not a full rewrite — should be shorter than the full prompt
    const fullPrompt = getCurrentSystemPrompt();
    expect(improvement.proposedDelta.length).toBeLessThan(fullPrompt.length);
  }, 300_000);
});
