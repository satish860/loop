/**
 * loop eval — Run benchmarks, grade answers, show results.
 *
 * Usage:
 *   loop eval --benchmark custom           Run eval on custom benchmark
 *   loop eval --benchmark custom@v1        Run specific version
 *   loop eval --benchmark custom --limit 5 Cost control
 */

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runEval, loadLatestRun, loadEvalRun, listEvalRuns, type EvalResultEntry } from "../eval/runner.js";
import { analyzeByDimension, formatAnalysis } from "../eval/analyzer.js";
import { createJudge, loadJudgePrompt } from "../eval/judge.js";
import { suggestImprovement, applyImprovement } from "../eval/improver.js";
import { loadHistory, formatHistory } from "../eval/history.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

export interface EvalOptions {
  benchmark?: string;
  limit?: string;
  analyze?: boolean | string;
  judgeCreate?: boolean | string;
  improve?: boolean | string;
  history?: boolean;
}

export async function evalCommand(opts: EvalOptions): Promise<void> {
  // --analyze: show error analysis
  if (opts.analyze !== undefined && opts.analyze !== false) {
    await showAnalysis(opts.analyze);
    return;
  }

  // --judge-create: build judge from eval run
  if (opts.judgeCreate !== undefined && opts.judgeCreate !== false) {
    await buildJudge(opts.judgeCreate);
    return;
  }

  // --improve: suggest and test system prompt improvement
  if (opts.improve !== undefined && opts.improve !== false) {
    await runImprove(opts.improve);
    return;
  }

  // --history: show the curve
  if (opts.history) {
    showHistory();
    return;
  }

  if (!opts.benchmark) {
    // No benchmark specified — show last run summary or help
    await showLastRun();
    return;
  }

  // Parse benchmark name and optional version: "custom@v1" → name="custom", version="v1"
  const { name, version } = parseBenchmarkArg(opts.benchmark);
  const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;

  if (limit !== undefined && (isNaN(limit) || limit < 1)) {
    console.error("Error: --limit must be a positive integer");
    process.exit(1);
  }

  console.log("");
  console.log(`${BOLD}Running eval: ${name}${version ? ` ${version}` : ""}${limit ? ` (limit ${limit})` : ""}${RESET}`);
  console.log("");

  const startTime = Date.now();

  try {
    const run = await runEval(name, {
      limit,
      version,
      onProgress: (done, total, result) => {
        const icon = result.pass ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`;
        const qPreview = truncate(result.question, 55);
        const elapsed = `${(result.elapsed / 1000).toFixed(1)}s`;
        const pad = String(done).padStart(String(total).length, " ");
        console.log(
          `  [${pad}/${total}] ${icon} ${DIM}"${qPreview}"${RESET}  ${DIM}${elapsed}${RESET}`,
        );
      },
    });

    // Summary
    const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const avgSec = (run.summary.elapsed / run.summary.total / 1000).toFixed(1);
    const accPct = (run.summary.accuracy * 100).toFixed(1);

    const accColor = run.summary.accuracy >= 0.8 ? GREEN : run.summary.accuracy >= 0.6 ? YELLOW : RED;

    console.log("");
    console.log(`  ${"─".repeat(50)}`);
    console.log(`  ${BOLD}Result:${RESET} ${accColor}${run.summary.pass}/${run.summary.total} correct (${accPct}%)${RESET}`);
    console.log(`  ${BOLD}Time:${RESET}   ${totalSec}s (avg ${avgSec}s/pair)`);
    console.log(`  ${BOLD}Run:${RESET}    ${run.id}`);
    console.log(`  ${"─".repeat(50)}`);

    // Show failures summary if any
    const failures = run.results.filter((r) => !r.pass);
    if (failures.length > 0 && failures.length <= 10) {
      console.log("");
      console.log(`  ${RED}${BOLD}Failures:${RESET}`);
      for (const f of failures) {
        console.log(`    ${RED}❌${RESET} ${DIM}"${truncate(f.question, 50)}"${RESET}`);
        console.log(`       ${DIM}Expected: ${truncate(f.expectedAnswer, 60)}${RESET}`);
        console.log(`       ${DIM}Got:      ${truncate(f.actualAnswer, 60)}${RESET}`);
        console.log(`       ${DIM}Reason:   ${f.reason}${RESET}`);
      }
    } else if (failures.length > 10) {
      console.log("");
      console.log(`  ${RED}${failures.length} failures — run \`loop eval --analyze\` for details${RESET}`);
    }

    console.log("");

  } catch (err) {
    console.error(`\nError: ${(err as Error).message}`);
    process.exit(1);
  }
}

// ── Show last run ──

async function showLastRun(): Promise<void> {
  const runs = listEvalRuns();

  if (runs.length === 0) {
    console.log("");
    console.log("  No eval runs yet.");
    console.log("");
    console.log("  Get started:");
    console.log(`    1. ${CYAN}loop generate-qa${RESET}                    Generate QA benchmark pairs`);
    console.log(`    2. ${CYAN}loop generate-qa --export csv${RESET}       Export for review`);
    console.log(`    3. ${CYAN}loop generate-qa --import file.csv${RESET}  Import reviewed pairs`);
    console.log(`    4. ${CYAN}loop eval --benchmark custom${RESET}        Run eval`);
    console.log("");
    return;
  }

  // Show all runs as history
  console.log("");
  console.log(`  ${BOLD}Eval Runs${RESET}`);
  console.log(`  ${"─".repeat(50)}`);

  for (const run of runs) {
    const date = run.meta.startTime.slice(0, 10);
    const accPct = (run.summary.accuracy * 100).toFixed(0);
    const accColor = run.summary.accuracy >= 0.8 ? GREEN : run.summary.accuracy >= 0.6 ? YELLOW : RED;
    console.log(
      `  ${date}  ${run.meta.benchmark} ${run.meta.version}  ${accColor}${accPct}%${RESET}  (${run.summary.total} pairs)`,
    );
  }

  console.log(`  ${"─".repeat(50)}`);

  if (runs.length >= 2) {
    const first = runs[0].summary.accuracy;
    const last = runs[runs.length - 1].summary.accuracy;
    const delta = ((last - first) * 100).toFixed(0);
    const sign = last >= first ? "+" : "";
    console.log(
      `  ${BOLD}Change:${RESET} ${(first * 100).toFixed(0)}% → ${(last * 100).toFixed(0)}% (${sign}${delta} points)`,
    );
  }

  console.log("");
}

// ── Analyze ──

async function showAnalysis(runIdOrFlag: boolean | string): Promise<void> {
  let run;

  if (typeof runIdOrFlag === "string" && runIdOrFlag !== "true") {
    // Specific run ID
    run = loadEvalRun(runIdOrFlag);
    if (!run) {
      console.error(`Error: Eval run "${runIdOrFlag}" not found.`);
      process.exit(1);
    }
  } else {
    // Latest run
    run = loadLatestRun();
    if (!run) {
      console.error("No eval runs found. Run `loop eval --benchmark custom` first.");
      process.exit(1);
    }
  }

  const accPct = (run.summary.accuracy * 100).toFixed(1);
  console.log("");
  console.log(`${BOLD}Error Analysis${RESET} — ${run.id}`);
  console.log(`${DIM}${run.summary.total} pairs, ${accPct}% accuracy${RESET}`);
  console.log("");

  const analysis = analyzeByDimension(run);
  console.log(formatAnalysis(analysis));
  console.log("");
}

// ── Judge ──

async function buildJudge(runIdOrFlag: boolean | string): Promise<void> {
  let run;

  if (typeof runIdOrFlag === "string" && runIdOrFlag !== "true") {
    run = loadEvalRun(runIdOrFlag);
    if (!run) {
      console.error(`Error: Eval run "${runIdOrFlag}" not found.`);
      process.exit(1);
    }
  } else {
    run = loadLatestRun();
    if (!run) {
      console.error("No eval runs found. Run `loop eval --benchmark custom` first.");
      process.exit(1);
    }
  }

  console.log("");
  console.log(`${BOLD}Building LLM Judge${RESET} from ${run.id}`);
  console.log(`${DIM}${run.results.length} graded examples (${run.summary.pass} pass, ${run.summary.fail} fail)${RESET}`);
  console.log("");

  try {
    console.log(`${DIM}  Generating judge prompt from training examples...${RESET}`);
    const result = await createJudge(run);

    console.log(`${DIM}  Testing judge on ${result.testCount} held-out examples...${RESET}`);
    console.log("");

    // Show test results
    for (const detail of result.testDetails) {
      const agreeIcon = detail.agree ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
      const humanIcon = detail.humanLabel ? "✅" : "❌";
      const judgeIcon = detail.judgeLabel ? "✅" : "❌";
      console.log(
        `  ${agreeIcon} "${truncate(detail.question, 45)}"  human:${humanIcon} judge:${judgeIcon}`,
      );
      if (!detail.agree) {
        console.log(`    ${DIM}Judge reason: ${detail.judgeReason}${RESET}`);
      }
    }

    console.log("");
    console.log(`  ${"─".repeat(50)}`);

    const agreePct = (result.agreement * 100).toFixed(0);
    const agreeColor = result.agreement >= 0.8 ? GREEN : result.agreement >= 0.6 ? YELLOW : RED;

    console.log(`  ${BOLD}Agreement:${RESET} ${agreeColor}${agreePct}%${RESET} (${result.testDetails.filter((d) => d.agree).length}/${result.testCount})`);
    console.log(`  ${BOLD}Train/Test:${RESET} ${result.trainCount}/${result.testCount}`);
    console.log(`  ${BOLD}Saved:${RESET} ${result.judgePath}`);
    console.log(`  ${"─".repeat(50)}`);

    if (result.agreement < 0.8) {
      console.log("");
      console.log(`  ${YELLOW}Agreement below 80%. Consider:${RESET}`);
      console.log(`  ${DIM}  - Run a larger eval (more examples = better judge)${RESET}`);
      console.log(`  ${DIM}  - Edit the judge prompt at: ${result.judgePath}${RESET}`);
    }

    console.log("");

  } catch (err) {
    console.error(`\nError: ${(err as Error).message}`);
    process.exit(1);
  }
}

// ── History ──

function showHistory(): void {
  const history = loadHistory();
  console.log("");
  console.log(formatHistory(history));
  console.log("");
}

// ── Improve ──

async function runImprove(runIdOrFlag: boolean | string): Promise<void> {
  let run;

  if (typeof runIdOrFlag === "string" && runIdOrFlag !== "true") {
    run = loadEvalRun(runIdOrFlag);
    if (!run) {
      console.error(`Error: Eval run "${runIdOrFlag}" not found.`);
      process.exit(1);
    }
  } else {
    run = loadLatestRun();
    if (!run) {
      console.error("No eval runs found. Run `loop eval --benchmark custom` first.");
      process.exit(1);
    }
  }

  const failures = run.results.filter((r) => !r.pass);
  if (failures.length === 0) {
    console.log(`\n  ${GREEN}All pairs passed!${RESET} Nothing to improve.\n`);
    return;
  }

  console.log("");
  console.log(`${BOLD}System Prompt Improvement${RESET} — ${run.id}`);
  console.log(`${DIM}${run.summary.total} pairs, ${failures.length} failures${RESET}`);
  console.log("");

  try {
    const improvement = await suggestImprovement(run, (step) => {
      console.log(`  ${DIM}${CYAN}▸${RESET}${DIM} ${step}${RESET}`);
    });

    // Show reflections
    console.log("");
    console.log(`  ${BOLD}─── REFLECTOR ───${RESET}`);
    for (const line of improvement.reflections.split("\n")) {
      if (line.trim()) console.log(`  ${DIM}${line}${RESET}`);
    }

    // Show proposed delta
    console.log("");
    console.log(`  ${BOLD}─── CURATOR ───${RESET}`);
    console.log(`  ${BOLD}Proposed addition to system prompt:${RESET}`);
    console.log("");
    for (const line of improvement.proposedDelta.split("\n")) {
      console.log(`  ${GREEN}+ ${line}${RESET}`);
    }

    // Show test results on failures
    console.log("");
    console.log(`  ${BOLD}─── TESTER ───${RESET}`);
    console.log(`  ${BOLD}Failed queries (before → after):${RESET}`);
    for (const r of improvement.failTestResults) {
      const before = "❌";
      const after = r.pass ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`;
      console.log(`    ${before}→${after} "${truncate(r.question, 50)}"`);
    }

    // Show regression check
    if (improvement.passTestResults.length > 0) {
      console.log("");
      console.log(`  ${BOLD}Regression check (${improvement.passTestResults.length} passing queries):${RESET}`);
      for (const r of improvement.passTestResults) {
        const icon = r.pass ? `${GREEN}✅${RESET}` : `${RED}⚠️  REGRESSION${RESET}`;
        console.log(`    ${icon} "${truncate(r.question, 50)}"`);
      }
    }

    // Summary
    const beforePct = (improvement.beforeAccuracy * 100).toFixed(0);
    const afterPct = (improvement.afterAccuracy * 100).toFixed(0);
    const delta = improvement.afterAccuracy - improvement.beforeAccuracy;
    const deltaPct = (delta * 100).toFixed(0);
    const deltaColor = delta > 0 ? GREEN : delta < 0 ? RED : YELLOW;

    console.log("");
    console.log(`  ${"─".repeat(50)}`);
    console.log(`  ${BOLD}Target:${RESET}      ${improvement.targetValue} (${improvement.targetDimension})`);
    console.log(`  ${BOLD}Before:${RESET}      ${beforePct}% on failed queries`);
    console.log(`  ${BOLD}After:${RESET}       ${deltaColor}${afterPct}%${RESET} (${delta >= 0 ? "+" : ""}${deltaPct} points)`);
    console.log(`  ${BOLD}Regressions:${RESET} ${improvement.regressions.length === 0 ? `${GREEN}none${RESET}` : `${RED}${improvement.regressions.length}${RESET}`}`);
    console.log(`  ${"─".repeat(50)}`);
    console.log("");

    // Apply prompt
    console.log(`  To apply: ${CYAN}loop eval --improve --apply${RESET}`);
    console.log(`  Or manually edit: ${DIM}~/.loop/system.md${RESET}`);
    console.log("");

    // Store the pending improvement so --apply can pick it up
    const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
    const pendingPath = join(HOME, ".loop", "eval", "pending-improvement.json");
    if (!existsSync(join(HOME, ".loop", "eval"))) {
      mkdirSync(join(HOME, ".loop", "eval"), { recursive: true });
    }
    writeFileSync(pendingPath, JSON.stringify({
      runId: run.id,
      improvement: {
        targetDimension: improvement.targetDimension,
        targetValue: improvement.targetValue,
        proposedDelta: improvement.proposedDelta,
        beforeAccuracy: improvement.beforeAccuracy,
        afterAccuracy: improvement.afterAccuracy,
        regressions: improvement.regressions,
      },
    }, null, 2), "utf-8");

  } catch (err) {
    console.error(`\nError: ${(err as Error).message}`);
    process.exit(1);
  }
}

// ── Helpers ──

function parseBenchmarkArg(arg: string): { name: string; version?: string } {
  const atIdx = arg.indexOf("@");
  if (atIdx >= 0) {
    return {
      name: arg.slice(0, atIdx),
      version: arg.slice(atIdx + 1),
    };
  }
  return { name: arg };
}

function truncate(s: string, max: number): string {
  // Clean up for display — collapse whitespace, remove newlines
  const clean = s.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + "…";
}
