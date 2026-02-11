import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CHAT_LOGS_DIR } from "./session-logger.js";

export interface Signal {
  /** Signal type */
  signal: "correction" | "reformulation" | "satisfaction" | "follow_up_depth";
  /** Confidence 0-1 */
  confidence: number;
  /** Which user turn triggered this signal */
  turn: number;
  /** Brief explanation */
  detail: string;
}

// ── Pattern dictionaries ──────────────────────────────────────────

const CORRECTION_PATTERNS = [
  /\bthat'?s?\s+(wrong|incorrect|not\s+right|inaccurate)\b/i,
  /\bno[,.]?\s+(it'?s?|the|that|actually)\b/i,
  /\bactually\s+(it'?s?|the|that)\b/i,
  /\bwrong[.,]?\s/i,
  /\bincorrect\b/i,
  /\bnot\s+correct\b/i,
  /\bthat'?s?\s+not\s+(what|how|the)\b/i,
  /\byou'?re\s+wrong\b/i,
  /\bthe\s+(correct|right|actual)\s+(answer|value|number|amount|figure)\s+is\b/i,
  /\bit\s+should\s+be\b/i,
  /\bshould\s+be\s+\$/i,
  /\bchanged\s+it\s+to\b/i,
];

const SATISFACTION_PATTERNS = [
  /\bthanks?\b/i,
  /\bthank\s+you\b/i,
  /\bgreat\b/i,
  /\bperfect\b/i,
  /\bexcellent\b/i,
  /\bgot\s+it\b/i,
  /\bthat'?s?\s+(right|correct|helpful|exactly)\b/i,
  /\bawesome\b/i,
  /\bnice\b/i,
  /\bgood\s+(answer|job|work)\b/i,
  /\bmakes\s+sense\b/i,
  /\bhelpful\b/i,
];

// ── Helpers ────────────────────────────────────────────────────────

/** Extract significant words from a sentence (lowercase, >2 chars, no stop words) */
function significantWords(text: string): Set<string> {
  const STOP = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "shall",
    "should", "may", "might", "must", "can", "could", "about", "above",
    "after", "again", "all", "also", "and", "any", "because", "before",
    "between", "both", "but", "by", "came", "com", "could", "did", "does",
    "each", "for", "from", "get", "got", "had", "has", "have", "her",
    "here", "him", "his", "how", "if", "in", "into", "its", "just",
    "let", "like", "make", "many", "me", "more", "most", "much", "my",
    "new", "not", "now", "of", "on", "one", "only", "or", "other",
    "our", "out", "over", "said", "she", "so", "some", "than", "that",
    "the", "them", "then", "there", "these", "they", "this", "those",
    "through", "to", "too", "under", "up", "upon", "very", "was", "way",
    "we", "well", "were", "what", "when", "where", "which", "while",
    "who", "whom", "why", "with", "you", "your",
  ]);
  const words = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  return new Set(words.filter((w) => w.length > 2 && !STOP.has(w)));
}

/** Jaccard similarity between two word sets */
function wordOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) {
    if (b.has(w)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/** Is the text a question? */
function isQuestion(text: string): boolean {
  return /\?/.test(text) || /^(what|who|when|where|why|how|which|is|are|does|do|can|could|will|would)\b/i.test(text.trim());
}

// ── Core detection ─────────────────────────────────────────────────

interface TurnEntry {
  type: string;
  role?: string;
  content?: string;
  turn?: number;
  [key: string]: unknown;
}

/**
 * Analyze a session log file and return detected signals.
 * Runs post-session (after session.end()), not during chat.
 */
export function detectSignals(logEntries: TurnEntry[]): Signal[] {
  const signals: Signal[] = [];
  const userTurns: { content: string; turn: number }[] = [];

  // Extract user turns in order
  for (const entry of logEntries) {
    if (entry.type === "turn" && entry.role === "user" && entry.content) {
      userTurns.push({
        content: entry.content as string,
        turn: (entry.turn as number) ?? userTurns.length + 1,
      });
    }
  }

  // ── 1. Correction detection ──
  for (const ut of userTurns) {
    for (const pattern of CORRECTION_PATTERNS) {
      if (pattern.test(ut.content)) {
        // Measure confidence: more explicit patterns → higher confidence
        const matchCount = CORRECTION_PATTERNS.filter((p) => p.test(ut.content)).length;
        const confidence = Math.min(0.5 + matchCount * 0.15, 1.0);

        signals.push({
          signal: "correction",
          confidence,
          turn: ut.turn,
          detail: `User correction detected at turn ${ut.turn}`,
        });
        break; // One correction signal per turn
      }
    }
  }

  // ── 2. Satisfaction detection ──
  for (const ut of userTurns) {
    for (const pattern of SATISFACTION_PATTERNS) {
      if (pattern.test(ut.content)) {
        const matchCount = SATISFACTION_PATTERNS.filter((p) => p.test(ut.content)).length;
        const confidence = Math.min(0.5 + matchCount * 0.15, 1.0);

        signals.push({
          signal: "satisfaction",
          confidence,
          turn: ut.turn,
          detail: `User satisfaction detected at turn ${ut.turn}`,
        });
        break; // One satisfaction signal per turn
      }
    }
  }

  // ── 3. Reformulation detection ──
  // If the user re-asks a similar question (word overlap > 0.4) within 2 turns
  const questionTurns = userTurns.filter((ut) => isQuestion(ut.content));
  for (let i = 1; i < questionTurns.length; i++) {
    const current = questionTurns[i];
    // Look back up to 2 previous questions
    for (let j = Math.max(0, i - 2); j < i; j++) {
      const prev = questionTurns[j];
      const overlap = wordOverlap(
        significantWords(prev.content),
        significantWords(current.content)
      );

      if (overlap >= 0.4) {
        signals.push({
          signal: "reformulation",
          confidence: Math.min(0.5 + overlap, 1.0),
          turn: current.turn,
          detail: `User reformulated question from turn ${prev.turn} at turn ${current.turn} (overlap: ${(overlap * 100).toFixed(0)}%)`,
        });
        break; // One reformulation per turn
      }
    }
  }

  // ── 4. Follow-up depth detection ──
  // 3+ user turns in a session = engaged
  if (userTurns.length >= 3) {
    signals.push({
      signal: "follow_up_depth",
      confidence: Math.min(0.5 + (userTurns.length - 2) * 0.1, 1.0),
      turn: userTurns[userTurns.length - 1].turn,
      detail: `${userTurns.length} turns — sustained engagement`,
    });
  }

  return signals;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Find session log file by session ID.
 * Session files are named: {timestamp}_{sessionId}.jsonl
 */
export function findSessionLogFile(sessionId: string, logsDir?: string): string | null {
  const dir = logsDir ?? CHAT_LOGS_DIR;
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  const match = files.find((f) => f.includes(sessionId));
  return match ? join(dir, match) : null;
}

/**
 * Read and parse a session JSONL log file.
 */
export function readSessionLog(filepath: string): TurnEntry[] {
  const raw = readFileSync(filepath, "utf-8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line));
}

/**
 * Analyze a session by ID. Returns detected signals.
 * This is the main API for Story 3.3.
 */
export function analyzeSession(sessionId: string, logsDir?: string): Signal[] {
  const logFile = findSessionLogFile(sessionId, logsDir);
  if (!logFile) {
    throw new Error(`Session log not found for ID: ${sessionId}`);
  }

  const entries = readSessionLog(logFile);
  return detectSignals(entries);
}
