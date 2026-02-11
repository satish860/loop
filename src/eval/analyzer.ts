/**
 * Eval Analyzer — slices eval run results by dimension to reveal failure patterns.
 *
 * Groups results by: questionType, difficulty, sourceFormat, edgeCase
 * Computes per-group accuracy. Highlights worst dimension.
 * Pure computation — no LLM calls.
 */

import type { EvalRun, EvalResultEntry } from "./runner.js";

// ── Types ──

export interface DimensionSlice {
  total: number;
  pass: number;
  fail: number;
  accuracy: number;
  failures: FailureExample[];
}

export interface FailureExample {
  id: string;
  question: string;
  expectedAnswer: string;
  actualAnswer: string;
  reason: string;
}

export interface WorstDimension {
  dimension: string;   // e.g., "questionType"
  value: string;       // e.g., "calculation"
  accuracy: number;
  total: number;
  failures: FailureExample[];
}

export interface DimensionAnalysis {
  byQuestionType: Record<string, DimensionSlice>;
  byDifficulty: Record<string, DimensionSlice>;
  bySourceFormat: Record<string, DimensionSlice>;
  byEdgeCase: Record<string, DimensionSlice>;
  worst: WorstDimension | null;
  overall: { total: number; pass: number; fail: number; accuracy: number };
}

// ── Core ──

/**
 * Analyze an eval run by slicing results across all dimensions.
 */
export function analyzeByDimension(run: EvalRun): DimensionAnalysis {
  const results = run.results;

  const byQuestionType = sliceBy(results, (r) => r.dimensions.questionType);
  const byDifficulty = sliceBy(results, (r) => r.dimensions.difficulty);
  const bySourceFormat = sliceBy(results, (r) => r.dimensions.sourceFormat);
  const byEdgeCase = sliceBy(results, (r) => r.dimensions.edgeCase);

  const passCount = results.filter((r) => r.pass).length;
  const overall = {
    total: results.length,
    pass: passCount,
    fail: results.length - passCount,
    accuracy: results.length > 0 ? passCount / results.length : 0,
  };

  // Find worst dimension value (lowest accuracy with at least 1 result)
  const worst = findWorst({
    questionType: byQuestionType,
    difficulty: byDifficulty,
    sourceFormat: bySourceFormat,
    edgeCase: byEdgeCase,
  });

  return { byQuestionType, byDifficulty, bySourceFormat, byEdgeCase, worst, overall };
}

// ── Slice helper ──

function sliceBy(
  results: EvalResultEntry[],
  keyFn: (r: EvalResultEntry) => string | undefined,
): Record<string, DimensionSlice> {
  const groups = new Map<string, EvalResultEntry[]>();

  for (const r of results) {
    const key = keyFn(r) || "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const slices: Record<string, DimensionSlice> = {};

  for (const [key, items] of groups) {
    const pass = items.filter((r) => r.pass).length;
    const fail = items.length - pass;
    const failures = items
      .filter((r) => !r.pass)
      .map((r) => ({
        id: r.id,
        question: r.question,
        expectedAnswer: r.expectedAnswer,
        actualAnswer: r.actualAnswer,
        reason: r.reason,
      }));

    slices[key] = {
      total: items.length,
      pass,
      fail,
      accuracy: items.length > 0 ? pass / items.length : 0,
      failures,
    };
  }

  return slices;
}

// ── Find worst ──

function findWorst(
  allDimensions: Record<string, Record<string, DimensionSlice>>,
): WorstDimension | null {
  let worst: WorstDimension | null = null;

  for (const [dimension, slices] of Object.entries(allDimensions)) {
    for (const [value, slice] of Object.entries(slices)) {
      if (value === "unknown") continue;
      if (slice.total === 0) continue;

      if (
        worst === null ||
        slice.accuracy < worst.accuracy ||
        (slice.accuracy === worst.accuracy && slice.fail > worst.failures.length)
      ) {
        worst = {
          dimension,
          value,
          accuracy: slice.accuracy,
          total: slice.total,
          failures: slice.failures,
        };
      }
    }
  }

  return worst;
}

// ── Formatting ──

/**
 * Format analysis as a displayable string.
 */
export function formatAnalysis(analysis: DimensionAnalysis): string {
  const lines: string[] = [];

  const { overall } = analysis;
  lines.push(
    `Overall: ${overall.pass}/${overall.total} correct (${(overall.accuracy * 100).toFixed(1)}%)`,
  );
  lines.push("");

  // Each dimension
  if (Object.keys(analysis.byQuestionType).length > 0) {
    lines.push(...formatDimensionBlock("By Question Type", analysis.byQuestionType));
  }
  if (Object.keys(analysis.byDifficulty).length > 0) {
    lines.push(...formatDimensionBlock("By Difficulty", analysis.byDifficulty));
  }
  if (Object.keys(analysis.bySourceFormat).length > 0) {
    lines.push(...formatDimensionBlock("By Source Format", analysis.bySourceFormat));
  }
  if (Object.keys(analysis.byEdgeCase).length > 0 &&
      !(Object.keys(analysis.byEdgeCase).length === 1 && analysis.byEdgeCase["unknown"])) {
    lines.push(...formatDimensionBlock("By Edge Case", analysis.byEdgeCase));
  }

  // Worst dimension callout
  if (analysis.worst) {
    const w = analysis.worst;
    lines.push("");
    lines.push(
      `⚠️  Worst: ${w.value} (${w.dimension}) @ ${(w.accuracy * 100).toFixed(0)}% — ${w.failures.length} failure${w.failures.length !== 1 ? "s" : ""}:`,
    );
    for (const f of w.failures.slice(0, 5)) {
      lines.push(`    ❌ "${truncate(f.question, 60)}"`);
      lines.push(`       Reason: ${f.reason}`);
    }
    if (w.failures.length > 5) {
      lines.push(`    ... and ${w.failures.length - 5} more`);
    }
  }

  return lines.join("\n");
}

function formatDimensionBlock(
  title: string,
  slices: Record<string, DimensionSlice>,
): string[] {
  const lines: string[] = [];
  lines.push(title + ":");

  // Sort by accuracy ascending (worst first)
  const sorted = Object.entries(slices)
    .filter(([key]) => key !== "unknown")
    .sort((a, b) => a[1].accuracy - b[1].accuracy);

  // Find max label length for alignment
  const maxLabel = Math.max(...sorted.map(([k]) => k.length), 10);

  for (const [key, slice] of sorted) {
    const pct = (slice.accuracy * 100).toFixed(0);
    const label = key.padEnd(maxLabel);
    const bar = makeBar(slice.accuracy, 20);
    const warn = slice.accuracy < 0.7 ? "  ⚠️" : "";
    lines.push(`  ${label}  ${pct.padStart(3)}% (${slice.pass}/${slice.total})  ${bar}${warn}`);
  }

  lines.push("");
  return lines;
}

function makeBar(fraction: number, width: number): string {
  const filled = Math.round(fraction * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + "…";
}
