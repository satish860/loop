import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CorpusManager } from "../core/corpus.js";
import { loadConfig, personaDisplayName } from "../core/config.js";
import { CHAT_LOGS_DIR } from "../core/session-logger.js";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

interface SessionStats {
  totalSessions: number;
  totalTurns: number;
  signals: Record<string, number>;
}

/** Scan all session JSONL files for stats */
function scanSessions(): SessionStats {
  const stats: SessionStats = { totalSessions: 0, totalTurns: 0, signals: {} };

  if (!existsSync(CHAT_LOGS_DIR)) return stats;

  const files = readdirSync(CHAT_LOGS_DIR).filter((f) => f.endsWith(".jsonl"));
  stats.totalSessions = files.length;

  for (const file of files) {
    try {
      const raw = readFileSync(join(CHAT_LOGS_DIR, file), "utf-8").trim();
      if (!raw) continue;

      for (const line of raw.split("\n")) {
        const entry = JSON.parse(line);

        if (entry.type === "session_end" && typeof entry.totalTurns === "number") {
          stats.totalTurns += entry.totalTurns;
        }

        if (entry.type === "signal" && entry.signal) {
          stats.signals[entry.signal] = (stats.signals[entry.signal] || 0) + 1;
        }
      }
    } catch {
      // Skip malformed files
    }
  }

  return stats;
}

export async function status(): Promise<void> {
  const config = loadConfig();

  // ─── Corpus ───
  const corpus = new CorpusManager();
  const docs = corpus.listDocuments();

  if (docs.length === 0) {
    console.log("Corpus: No documents ingested");
    console.log(`  Run: loop ingest <file> or loop ingest <folder>`);
  } else {
    const byFormat: Record<string, number> = {};
    for (const d of docs) {
      byFormat[d.format] = (byFormat[d.format] || 0) + 1;
    }
    const breakdown = Object.entries(byFormat)
      .map(([fmt, n]) => `${n} ${fmt.toUpperCase()}`)
      .join(", ");

    console.log(`Corpus: ${docs.length} document${docs.length !== 1 ? "s" : ""} (${breakdown})`);
  }

  console.log(`Persona: ${personaDisplayName(config.persona)}`);
  console.log();

  // ─── Chat sessions ───
  const sessionStats = scanSessions();

  if (sessionStats.totalSessions === 0) {
    console.log("Chat: No sessions yet");
    console.log(`  Run: loop chat`);
  } else {
    console.log(
      `Chat: ${sessionStats.totalSessions} session${sessionStats.totalSessions !== 1 ? "s" : ""}, ${sessionStats.totalTurns} turn${sessionStats.totalTurns !== 1 ? "s" : ""}`
    );

    // ─── Signals ───
    const sigEntries = Object.entries(sessionStats.signals);
    if (sigEntries.length > 0) {
      const parts = sigEntries.map(([type, count]) => `${count} ${type}${count !== 1 ? "s" : ""}`);
      console.log(`Signals: ${parts.join(", ")}`);
    }
  }

  console.log();

  // ─── Benchmark (placeholder for EPIC 4) ───
  const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
  const benchmarkDir = join(HOME, ".loop", "benchmarks");
  if (existsSync(benchmarkDir)) {
    const benchmarks = readdirSync(benchmarkDir).filter((f) => {
      return existsSync(join(benchmarkDir, f, "qa-pairs.jsonl"));
    });
    if (benchmarks.length > 0) {
      for (const b of benchmarks) {
        const pairsFile = join(benchmarkDir, b, "qa-pairs.jsonl");
        const pairCount = readFileSync(pairsFile, "utf-8").trim().split("\n").length;
        console.log(`Benchmark: ${b} (${pairCount} QA pairs)`);
      }
    }
  }
}
