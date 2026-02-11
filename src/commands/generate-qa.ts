import { generateQA, type GenerateQAResult } from "../core/qa-generator.js";
import { exportQAToCSV, importQAFromCSV } from "../core/qa-review.js";
import { mineChatsForQA, minedToQAPairs } from "../eval/chat-miner.js";
import { loadVersionedBenchmark } from "../core/benchmark-version.js";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

export interface GenerateQACliOptions {
  count?: string;
  export?: string;   // "csv" or a file path
  import?: string;   // path to reviewed CSV
  fromChats?: boolean;
}

export async function generateQACommand(opts?: GenerateQACliOptions): Promise<void> {
  // ── From chats mode ──
  if (opts?.fromChats) {
    try {
      const result = mineChatsForQA();

      if (result.sessionsScanned === 0) {
        console.log(`\nNo chat sessions found. Run ${CYAN}loop chat${RESET} first.\n`);
        return;
      }

      console.log(`\n${CYAN}Chat Log Miner${RESET}`);
      console.log(`Scanned ${result.sessionsScanned} session${result.sessionsScanned !== 1 ? "s" : ""} (${result.turnsScanned} turns)\n`);

      if (result.pairs.length === 0) {
        console.log("No QA candidates found in chat logs.");
        console.log(`${DIM}Chat sessions need real questions (not just greetings) to extract pairs.${RESET}\n`);
        return;
      }

      // Deduplicate against existing benchmark
      const existing = loadVersionedBenchmark();
      const qaPairs = minedToQAPairs(result.pairs, existing?.pairs);

      console.log(`Found ${GREEN}${result.pairs.length}${RESET} QA candidates:`);
      console.log(`  🔧 Corrections:  ${result.corrections} (high-value — user provided ground truth)`);
      console.log(`  ✅ Satisfied:    ${result.satisfied} (user confirmed answer was good)`);
      console.log(`  📝 Regular Q&A:  ${result.regular}`);

      if (existing && result.pairs.length !== qaPairs.length) {
        console.log(`\n${DIM}Deduplicated: ${result.pairs.length - qaPairs.length} pairs already in benchmark${RESET}`);
      }

      console.log(`\n${GREEN}${qaPairs.length} new unique pairs${RESET}`);

      // Show samples
      for (const p of qaPairs.slice(0, 5)) {
        const icon = p.source?.includes("correction") ? "🔧" : p.source?.includes("satisfied") ? "✅" : "📝";
        console.log(`  ${icon} "${p.question.slice(0, 60)}${p.question.length > 60 ? "…" : ""}"`);
        console.log(`     ${DIM}→ ${p.expectedAnswer.slice(0, 70)}${p.expectedAnswer.length > 70 ? "…" : ""}${RESET}`);
      }

      if (qaPairs.length > 0) {
        // Save as draft
        const { writeFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
        const draftPath = join(HOME, ".loop", "benchmarks", "custom", "qa-pairs-draft.jsonl");
        const { mkdirSync, existsSync } = await import("node:fs");
        const dir = join(HOME, ".loop", "benchmarks", "custom");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(draftPath, qaPairs.map((p) => JSON.stringify(p)).join("\n") + "\n", "utf-8");

        console.log(`\n${DIM}Saved to: ${draftPath}${RESET}`);
        console.log(`\nNext: ${CYAN}loop generate-qa --export csv${RESET} to review, then ${CYAN}loop generate-qa --import reviewed.csv${RESET}`);
      }

      console.log("");
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // ── Export mode ──
  if (opts?.export) {
    try {
      const outputPath = opts.export === "csv" ? undefined : opts.export;
      const csvPath = exportQAToCSV(outputPath);
      console.log(`${GREEN}✅ Exported QA pairs to CSV${RESET}`);
      console.log(`${DIM}${csvPath}${RESET}`);
      console.log(`\nOpen in Excel, review each pair, then change the "status" column:`);
      console.log(`  ${CYAN}keep${RESET}    — pair is good (default)`);
      console.log(`  ${CYAN}discard${RESET} — remove this pair`);
      console.log(`  ${CYAN}edit${RESET}    — you edited the question or answer`);
      console.log(`\nWhen done: ${CYAN}loop generate-qa --import ${csvPath}${RESET}`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // ── Import mode ──
  if (opts?.import) {
    try {
      const result = importQAFromCSV(opts.import);
      console.log(`\n${GREEN}✅ Imported ${result.total} QA pairs → benchmark ${result.version}${RESET}`);
      console.log(`  Kept:      ${result.kept}`);
      console.log(`  Edited:    ${result.edited}`);
      console.log(`  Discarded: ${result.discarded}`);
      console.log(`\n${DIM}Benchmark saved: ${result.benchmarkPath}${RESET}`);
      console.log(`\nReady to eval: ${CYAN}loop eval --benchmark custom${RESET}`);
      console.log(`  or specific: ${CYAN}loop eval --benchmark custom@${result.version}${RESET}`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // ── Generate mode ──
  const count = opts?.count ? parseInt(opts.count, 10) : 50;

  if (isNaN(count) || count < 1) {
    console.error("Error: --count must be a positive number");
    process.exit(1);
  }

  console.log(`\n${CYAN}Loop QA Generator${RESET}`);
  console.log(`Generating ${count} QA pairs from corpus...\n`);

  try {
    const result = await generateQA({
      count,
      onProgress: (msg) => {
        console.log(`${DIM}  ${CYAN}▸${RESET}${DIM} ${msg}${RESET}`);
      },
    });

    printSummary(result);

    // Suggest next step
    console.log(`Next: ${CYAN}loop generate-qa --export csv${RESET} to review in Excel`);
  } catch (err: any) {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  }
}

function printSummary(result: GenerateQAResult): void {
  const { pairs, outputPath, coverage } = result;

  console.log(`\n${GREEN}✅ Generated ${pairs.length} QA pairs${RESET}`);
  console.log(`${DIM}Saved to: ${outputPath}${RESET}\n`);

  // Coverage by question type
  console.log("By Question Type:");
  for (const [type, count] of Object.entries(coverage.questionTypes).sort((a, b) => b[1] - a[1])) {
    const bar = "█".repeat(Math.max(1, Math.round((count / pairs.length) * 20)));
    console.log(`  ${type.padEnd(14)} ${String(count).padStart(3)} ${DIM}${bar}${RESET}`);
  }

  // Coverage by difficulty
  console.log("\nBy Difficulty:");
  for (const [diff, count] of Object.entries(coverage.difficulties).sort((a, b) => b[1] - a[1])) {
    const bar = "█".repeat(Math.max(1, Math.round((count / pairs.length) * 20)));
    console.log(`  ${diff.padEnd(14)} ${String(count).padStart(3)} ${DIM}${bar}${RESET}`);
  }

  // Coverage by source format
  console.log("\nBy Source Format:");
  for (const [fmt, count] of Object.entries(coverage.sourceFormats).sort((a, b) => b[1] - a[1])) {
    const bar = "█".repeat(Math.max(1, Math.round((count / pairs.length) * 20)));
    console.log(`  ${fmt.padEnd(14)} ${String(count).padStart(3)} ${DIM}${bar}${RESET}`);
  }

  // Edge cases
  if (Object.keys(coverage.edgeCases).length > 0) {
    console.log("\nEdge Cases:");
    for (const [ec, count] of Object.entries(coverage.edgeCases)) {
      console.log(`  ${ec.padEnd(14)} ${String(count).padStart(3)}`);
    }
  }

  // Sample pairs
  console.log(`\n${YELLOW}Sample pairs:${RESET}`);
  const samples = pairs.slice(0, 3);
  for (const p of samples) {
    console.log(`  ${DIM}[${p.id}]${RESET} ${p.question}`);
    const answer = p.expectedAnswer.length > 80
      ? p.expectedAnswer.slice(0, 77) + "..."
      : p.expectedAnswer;
    console.log(`  ${DIM}→ ${answer}${RESET}`);
    console.log(`  ${DIM}  (${p.dimensions.questionType}, ${p.dimensions.difficulty}, ${p.source})${RESET}`);
    console.log();
  }
}
