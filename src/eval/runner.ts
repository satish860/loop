/**
 * Eval Runner — runs QA benchmark pairs through Pi and grades results.
 *
 * For each pair:
 *   1. Create fresh Pi session (no context leakage)
 *   2. Send question → Pi reads docs, answers
 *   3. Grade answer against expected (LLM comparison)
 *   4. Log result
 *
 * Results saved to ~/.loop/eval/runs/{benchmark}-{timestamp}.jsonl
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { CorpusManager } from "../core/corpus.js";
import { createLoopSession, buildSystemPrompt } from "../core/session.js";
import { loadVersionedBenchmark, type VersionedBenchmark } from "../core/benchmark-version.js";
import { resolvePersona } from "../core/config.js";
import { gradeAnswer, type GradeResult } from "./grader.js";
import type { QAPair } from "../core/qa-generator.js";
import { createHash } from "node:crypto";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const RUNS_DIR = join(HOME, ".loop", "eval", "runs");

// ── Types ──

export interface EvalResultEntry {
  id: string;
  question: string;
  expectedAnswer: string;
  actualAnswer: string;
  pass: boolean;
  reason: string;
  elapsed: number; // ms
  dimensions: {
    questionType?: string;
    difficulty?: string;
    sourceFormat?: string;
    edgeCase?: string;
  };
}

export interface EvalRunMeta {
  type: "meta";
  benchmark: string;
  version: string;
  startTime: string;
  systemPromptHash: string;
  pairCount: number;
}

export interface EvalRunSummary {
  type: "summary";
  total: number;
  pass: number;
  fail: number;
  accuracy: number;
  elapsed: number; // ms total
}

export interface EvalRun {
  id: string;       // filename stem, e.g., "custom-2026-02-11T07:30:00Z"
  meta: EvalRunMeta;
  results: EvalResultEntry[];
  summary: EvalRunSummary;
}

export interface RunEvalOptions {
  limit?: number;
  version?: string; // benchmark version, e.g., "v1"
  onProgress?: (done: number, total: number, result: EvalResultEntry) => void;
}

// ── Runner ──

/**
 * Run an eval benchmark. Returns the complete eval run with all results.
 */
export async function runEval(
  benchmarkName: string,
  opts?: RunEvalOptions,
): Promise<EvalRun> {
  // Load benchmark
  const benchmark = loadBenchmarkByName(benchmarkName, opts?.version);
  if (!benchmark) {
    throw new Error(
      `Benchmark "${benchmarkName}" not found. Run \`loop generate-qa\` first.`,
    );
  }

  // Apply limit
  let pairs = benchmark.pairs;
  if (opts?.limit && opts.limit < pairs.length) {
    pairs = pairs.slice(0, opts.limit);
  }

  // Verify corpus exists
  const corpus = new CorpusManager();
  const docs = corpus.listDocuments();
  if (docs.length === 0) {
    throw new Error("No documents ingested. Run `loop ingest <source>` first.");
  }

  // System prompt hash for tracking
  const persona = resolvePersona();
  const promptHash = createHash("sha256")
    .update(buildSystemPrompt(persona))
    .digest("hex")
    .slice(0, 12);

  const startTime = new Date().toISOString();
  const runId = `${benchmarkName}-${startTime.replace(/[:.]/g, "-")}`;

  const meta: EvalRunMeta = {
    type: "meta",
    benchmark: benchmarkName,
    version: benchmark.version,
    startTime,
    systemPromptHash: promptHash,
    pairCount: pairs.length,
  };

  // Ensure runs dir exists
  mkdirSync(RUNS_DIR, { recursive: true });

  // Write meta line first (so partial runs are readable)
  const runPath = join(RUNS_DIR, `${runId}.jsonl`);
  writeFileSync(runPath, JSON.stringify(meta) + "\n", "utf-8");

  const results: EvalResultEntry[] = [];
  const runStartMs = Date.now();

  // Run each pair
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const pairStart = Date.now();

    try {
      // Fresh Pi session per pair (no context leakage)
      const actualAnswer = await queryPair(pair, corpus.dir);
      const pairElapsed = Date.now() - pairStart;

      // Grade — measure grading time separately but include in total
      const gradeStart = Date.now();
      const grade = await gradeAnswer(pair.question, pair.expectedAnswer, actualAnswer);
      const totalElapsed = Date.now() - pairStart;

      const entry: EvalResultEntry = {
        id: pair.id,
        question: pair.question,
        expectedAnswer: pair.expectedAnswer,
        actualAnswer: actualAnswer.trim(),
        pass: grade.pass,
        reason: grade.reason,
        elapsed: totalElapsed,
        dimensions: {
          questionType: pair.dimensions?.questionType,
          difficulty: pair.dimensions?.difficulty,
          sourceFormat: pair.dimensions?.sourceFormat,
          edgeCase: pair.dimensions?.edgeCase,
        },
      };

      results.push(entry);

      // Append to JSONL (incremental — crash-safe)
      appendToFile(runPath, JSON.stringify(entry));

      // Report progress
      opts?.onProgress?.(i + 1, pairs.length, entry);
    } catch (err) {
      // If a pair fails entirely (session error, etc.), log as fail
      const entry: EvalResultEntry = {
        id: pair.id,
        question: pair.question,
        expectedAnswer: pair.expectedAnswer,
        actualAnswer: "",
        pass: false,
        reason: `Error: ${(err as Error).message}`,
        elapsed: Date.now() - pairStart,
        dimensions: {
          questionType: pair.dimensions?.questionType,
          difficulty: pair.dimensions?.difficulty,
          sourceFormat: pair.dimensions?.sourceFormat,
          edgeCase: pair.dimensions?.edgeCase,
        },
      };

      results.push(entry);
      appendToFile(runPath, JSON.stringify(entry));
      opts?.onProgress?.(i + 1, pairs.length, entry);
    }
  }

  const totalElapsed = Date.now() - runStartMs;
  const passCount = results.filter((r) => r.pass).length;

  const summary: EvalRunSummary = {
    type: "summary",
    total: results.length,
    pass: passCount,
    fail: results.length - passCount,
    accuracy: results.length > 0 ? passCount / results.length : 0,
    elapsed: totalElapsed,
  };

  // Append summary line
  appendToFile(runPath, JSON.stringify(summary));

  return {
    id: runId,
    meta,
    results,
    summary,
  };
}

// ── Query a single QA pair ──

/**
 * Send a question to Pi using a fresh session and collect the full answer.
 */
async function queryPair(pair: QAPair, corpusDir: string): Promise<string> {
  const session = await createLoopSession(corpusDir, { fresh: true });

  let fullResponse = "";
  const unsubscribe = session.subscribe((event) => {
    if (
      event.type === "message_update" &&
      (event as any).assistantMessageEvent?.type === "text_delta"
    ) {
      fullResponse += (event as any).assistantMessageEvent.delta;
    }
  });

  await session.prompt(pair.question);
  unsubscribe();
  session.dispose();

  return fullResponse;
}

// ── Load/list runs ──

/**
 * Load a saved eval run by ID.
 */
export function loadEvalRun(runId: string): EvalRun | null {
  const runPath = join(RUNS_DIR, `${runId}.jsonl`);
  if (!existsSync(runPath)) return null;

  return parseRunFile(runPath);
}

/**
 * Load the most recent eval run, optionally filtered by benchmark name.
 */
export function loadLatestRun(benchmarkName?: string): EvalRun | null {
  if (!existsSync(RUNS_DIR)) return null;

  const files = readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .filter((f) => !benchmarkName || f.startsWith(benchmarkName + "-"))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  return parseRunFile(join(RUNS_DIR, files[0]));
}

/**
 * List all eval runs (metadata only — doesn't load full results).
 */
export function listEvalRuns(benchmarkName?: string): Array<{ id: string; meta: EvalRunMeta; summary: EvalRunSummary }> {
  if (!existsSync(RUNS_DIR)) return [];

  const files = readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .filter((f) => !benchmarkName || f.startsWith(benchmarkName + "-"))
    .sort();

  const runs: Array<{ id: string; meta: EvalRunMeta; summary: EvalRunSummary }> = [];

  for (const file of files) {
    const runPath = join(RUNS_DIR, file);
    const lines = readFileSync(runPath, "utf-8").trim().split("\n");

    let meta: EvalRunMeta | null = null;
    let summary: EvalRunSummary | null = null;

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "meta") meta = parsed;
        if (parsed.type === "summary") summary = parsed;
      } catch { /* skip bad lines */ }
    }

    if (meta && summary) {
      const id = file.replace(/\.jsonl$/, "");
      runs.push({ id, meta, summary });
    }
  }

  return runs;
}

// ── Helpers ──

function loadBenchmarkByName(name: string, version?: string): VersionedBenchmark | null {
  if (name === "custom") {
    return loadVersionedBenchmark(version);
  }
  // Future: financebench, etc.
  return loadVersionedBenchmark(version);
}

function appendToFile(filepath: string, line: string): void {
  appendFileSync(filepath, line + "\n", "utf-8");
}

function parseRunFile(filepath: string): EvalRun | null {
  const lines = readFileSync(filepath, "utf-8").trim().split("\n");
  if (lines.length === 0) return null;

  let meta: EvalRunMeta | null = null;
  let summary: EvalRunSummary | null = null;
  const results: EvalResultEntry[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "meta") {
        meta = parsed;
      } else if (parsed.type === "summary") {
        summary = parsed;
      } else if (parsed.id && parsed.question) {
        results.push(parsed);
      }
    } catch { /* skip */ }
  }

  if (!meta) return null;

  // If no summary (partial run), compute it
  if (!summary) {
    const passCount = results.filter((r) => r.pass).length;
    summary = {
      type: "summary",
      total: results.length,
      pass: passCount,
      fail: results.length - passCount,
      accuracy: results.length > 0 ? passCount / results.length : 0,
      elapsed: results.reduce((sum, r) => sum + r.elapsed, 0),
    };
  }

  const id = join(filepath).split(/[\\/]/).pop()?.replace(/\.jsonl$/, "") ?? "";
  return { id, meta, results, summary };
}
