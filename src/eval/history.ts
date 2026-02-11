/**
 * The Curve — eval history visualization.
 *
 * Reads all eval runs chronologically and shows accuracy over time.
 * Cross-references with improvements.jsonl for context notes.
 * This IS the product's signature output.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadImprovements, type ImprovementLog } from "./improver.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const RUNS_DIR = join(HOME, ".loop", "eval", "runs");

// ── Types ──

export interface HistoryEntry {
  date: string;           // YYYY-MM-DD
  timestamp: string;      // full ISO
  runId: string;
  benchmark: string;
  version: string;
  accuracy: number;
  total: number;
  pass: number;
  fail: number;
  elapsed: number;
  note?: string;          // from improvements.jsonl
  promptHash: string;
}

export interface History {
  entries: HistoryEntry[];
  firstAccuracy: number | null;
  lastAccuracy: number | null;
  delta: number | null;     // last - first (in points, e.g., +20)
}

// ── Load History ──

/**
 * Load eval history — all runs sorted chronologically.
 */
export function loadHistory(benchmarkName?: string): History {
  if (!existsSync(RUNS_DIR)) {
    return { entries: [], firstAccuracy: null, lastAccuracy: null, delta: null };
  }

  const files = readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .filter((f) => !benchmarkName || f.startsWith(benchmarkName + "-"))
    .sort(); // alphabetical = chronological (timestamp in filename)

  const improvements = loadImprovements();
  const entries: HistoryEntry[] = [];

  for (const file of files) {
    const filepath = join(RUNS_DIR, file);
    const lines = readFileSync(filepath, "utf-8").trim().split("\n");

    let meta: any = null;
    let summary: any = null;

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "meta") meta = parsed;
        if (parsed.type === "summary") summary = parsed;
      } catch { /* skip */ }
    }

    if (!meta || !summary) continue;

    const runId = file.replace(/\.jsonl$/, "");

    // Find matching improvement note
    const note = findNote(meta.startTime, improvements);

    entries.push({
      date: meta.startTime.slice(0, 10),
      timestamp: meta.startTime,
      runId,
      benchmark: meta.benchmark,
      version: meta.version,
      accuracy: summary.accuracy,
      total: summary.total,
      pass: summary.pass,
      fail: summary.fail,
      elapsed: summary.elapsed,
      note,
      promptHash: meta.systemPromptHash,
    });
  }

  const firstAccuracy = entries.length > 0 ? entries[0].accuracy : null;
  const lastAccuracy = entries.length > 0 ? entries[entries.length - 1].accuracy : null;
  const delta = firstAccuracy !== null && lastAccuracy !== null
    ? lastAccuracy - firstAccuracy
    : null;

  return { entries, firstAccuracy, lastAccuracy, delta };
}

// ── Format ──

/**
 * Format history as a displayable string — THE CURVE.
 */
export function formatHistory(history: History): string {
  if (history.entries.length === 0) {
    return "No eval runs yet. Run `loop eval --benchmark custom` to start.";
  }

  const lines: string[] = [];

  lines.push("THE CURVE");
  lines.push("─".repeat(65));

  // Find max bar width
  const maxBarWidth = 30;

  for (const entry of history.entries) {
    const pct = (entry.accuracy * 100).toFixed(0);
    const bar = makeBar(entry.accuracy, maxBarWidth);
    const note = entry.note ? `  ${entry.note}` : "";

    lines.push(
      `${entry.date}  ${entry.benchmark} ${entry.version}  ${pct.padStart(3)}%  ${bar}  (${entry.total} pairs)${note}`,
    );
  }

  lines.push("─".repeat(65));

  if (history.entries.length === 1) {
    const pct = (history.entries[0].accuracy * 100).toFixed(0);
    lines.push(`Baseline: ${pct}%`);
  } else if (history.delta !== null && history.firstAccuracy !== null && history.lastAccuracy !== null) {
    const firstPct = (history.firstAccuracy * 100).toFixed(0);
    const lastPct = (history.lastAccuracy * 100).toFixed(0);
    const deltaPct = (history.delta * 100).toFixed(0);
    const sign = history.delta >= 0 ? "+" : "";
    lines.push(`Improvement: ${firstPct}% → ${lastPct}% (${sign}${deltaPct} points over ${history.entries.length} runs)`);
  }

  return lines.join("\n");
}

// ── Helpers ──

function makeBar(fraction: number, width: number): string {
  const filled = Math.round(fraction * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/**
 * Find improvement note for a run timestamp.
 * Matches if an improvement was applied within 1 hour before the run.
 */
function findNote(runTimestamp: string, improvements: ImprovementLog[]): string | undefined {
  if (improvements.length === 0) return undefined;

  const runTime = new Date(runTimestamp).getTime();

  // Find the most recent improvement applied before this run
  let bestMatch: ImprovementLog | null = null;
  let bestTimeDiff = Infinity;

  for (const imp of improvements) {
    if (!imp.applied) continue;
    const impTime = new Date(imp.timestamp).getTime();
    const diff = runTime - impTime;

    // Improvement must be before the run, within 24 hours
    if (diff > 0 && diff < 24 * 60 * 60 * 1000 && diff < bestTimeDiff) {
      bestMatch = imp;
      bestTimeDiff = diff;
    }
  }

  if (bestMatch) {
    return `fix: ${bestMatch.targetValue}`;
  }

  // First run = baseline
  return undefined;
}
