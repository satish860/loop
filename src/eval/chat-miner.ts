/**
 * Chat Miner — extracts QA pair candidates from chat session logs.
 *
 * Reads JSONL chat logs, finds question-answer turns, and identifies
 * corrections (high-value pairs where user provided ground truth).
 * Outputs in QAPair format for human review and benchmark import.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHAT_LOGS_DIR } from "../core/session-logger.js";
import { detectSignals, type Signal } from "../core/signal-detector.js";
import type { QAPair } from "../core/qa-generator.js";

// ── Types ──

export interface MinedPair {
  question: string;
  answer: string;
  source: "chat_correction" | "chat_satisfied" | "chat_qa";
  sessionFile: string;
  turnNumber: number;
  confidence: number;    // 0-1, corrections are highest
  correctedAnswer?: string;  // If correction, what user said the answer should be
}

export interface MineResult {
  pairs: MinedPair[];
  sessionsScanned: number;
  turnsScanned: number;
  corrections: number;
  satisfied: number;
  regular: number;
}

interface TurnEntry {
  type: string;
  role?: string;
  content?: string;
  turn?: number;
  [key: string]: unknown;
}

// ── Core ──

/**
 * Mine all chat session logs for QA pair candidates.
 */
export function mineChatsForQA(logsDir?: string): MineResult {
  const dir = logsDir ?? CHAT_LOGS_DIR;

  if (!existsSync(dir)) {
    return { pairs: [], sessionsScanned: 0, turnsScanned: 0, corrections: 0, satisfied: 0, regular: 0 };
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();

  const allPairs: MinedPair[] = [];
  let totalTurns = 0;

  for (const file of files) {
    const filepath = join(dir, file);
    const raw = readFileSync(filepath, "utf-8").trim();
    if (!raw) continue;

    const entries: TurnEntry[] = raw.split("\n").map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean) as TurnEntry[];

    // Count turns
    const turns = entries.filter((e) => e.type === "turn");
    totalTurns += turns.length;

    // Detect signals for this session
    const signals = detectSignals(entries);

    // Extract QA pairs from user/assistant turn pairs
    const pairs = extractPairsFromSession(entries, signals, file);
    allPairs.push(...pairs);
  }

  const corrections = allPairs.filter((p) => p.source === "chat_correction").length;
  const satisfied = allPairs.filter((p) => p.source === "chat_satisfied").length;
  const regular = allPairs.filter((p) => p.source === "chat_qa").length;

  return {
    pairs: allPairs,
    sessionsScanned: files.length,
    turnsScanned: totalTurns,
    corrections,
    satisfied,
    regular,
  };
}

/**
 * Convert mined pairs to QAPair format for benchmark import.
 */
export function minedToQAPairs(mined: MinedPair[], existingPairs?: QAPair[]): QAPair[] {
  // Deduplicate against existing benchmark
  const existingQuestions = new Set(
    (existingPairs ?? []).map((p) => normalize(p.question)),
  );

  const unique = mined.filter((m) => !existingQuestions.has(normalize(m.question)));

  return unique.map((m, i) => ({
    id: `chat-${String(i + 1).padStart(3, "0")}`,
    question: m.question,
    expectedAnswer: m.source === "chat_correction" && m.correctedAnswer
      ? m.correctedAnswer
      : m.answer,
    source: `chat session: ${m.sessionFile}`,
    dimensions: {
      questionType: "factual",
      difficulty: "surface",
      sourceFormat: "cross-format",
    },
    status: "keep" as const,
  }));
}

// ── Extraction ──

function extractPairsFromSession(
  entries: TurnEntry[],
  signals: Signal[],
  filename: string,
): MinedPair[] {
  const pairs: MinedPair[] = [];

  // Build ordered list of turns
  const turns: Array<{ role: string; content: string; turn: number }> = [];
  for (const entry of entries) {
    if (entry.type === "turn" && entry.role && entry.content) {
      turns.push({
        role: entry.role as string,
        content: entry.content as string,
        turn: (entry.turn as number) ?? turns.length + 1,
      });
    }
  }

  // Index signals by turn number
  const correctionTurns = new Set(
    signals.filter((s) => s.signal === "correction").map((s) => s.turn),
  );
  const satisfactionTurns = new Set(
    signals.filter((s) => s.signal === "satisfaction").map((s) => s.turn),
  );

  // Walk through user-assistant pairs
  for (let i = 0; i < turns.length - 1; i++) {
    const userTurn = turns[i];
    const assistantTurn = turns[i + 1];

    if (userTurn.role !== "user" || assistantTurn.role !== "assistant") continue;

    // Skip very short questions (greetings, "ok", etc.)
    if (userTurn.content.trim().length < 10) continue;

    // Skip if not a question
    if (!isQuestion(userTurn.content)) continue;

    // Check if the NEXT user turn is a correction
    const nextUserTurn = turns.find((t, idx) => idx > i + 1 && t.role === "user");
    const nextTurnNum = nextUserTurn?.turn;
    const isCorrection = nextTurnNum !== undefined && correctionTurns.has(nextTurnNum);

    // Check if user expressed satisfaction after this answer
    const isSatisfied = satisfactionTurns.has(userTurn.turn + 1) ||
      (nextTurnNum !== undefined && satisfactionTurns.has(nextTurnNum));

    if (isCorrection && nextUserTurn) {
      // High-value: user corrected the answer → extract ground truth
      pairs.push({
        question: userTurn.content,
        answer: assistantTurn.content,
        source: "chat_correction",
        sessionFile: filename,
        turnNumber: userTurn.turn,
        confidence: 0.9,
        correctedAnswer: extractCorrectedValue(nextUserTurn.content),
      });
    } else if (isSatisfied) {
      // Medium-value: user was happy with the answer
      pairs.push({
        question: userTurn.content,
        answer: assistantTurn.content,
        source: "chat_satisfied",
        sessionFile: filename,
        turnNumber: userTurn.turn,
        confidence: 0.7,
      });
    } else {
      // Low-value: regular Q&A (no signal either way)
      pairs.push({
        question: userTurn.content,
        answer: assistantTurn.content,
        source: "chat_qa",
        sessionFile: filename,
        turnNumber: userTurn.turn,
        confidence: 0.4,
      });
    }
  }

  return pairs;
}

// ── Helpers ──

function isQuestion(text: string): boolean {
  return /\?/.test(text) ||
    /^(what|who|when|where|why|how|which|is|are|does|do|can|could|will|would|tell|show|find|list|calculate|compare)/i.test(text.trim());
}

/**
 * Extract the corrected value from a correction message.
 * e.g., "No, it's $420 not $350" → "$420 not $350"
 * Falls back to the full message.
 */
function extractCorrectedValue(correctionText: string): string {
  // Try to extract the "it's X" pattern
  const match = correctionText.match(/(?:it'?s?|should be|actually|correct (?:answer|value) is)\s+(.+)/i);
  if (match) return match[1].trim();
  return correctionText;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}
