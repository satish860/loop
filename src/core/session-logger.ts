import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
export const CHAT_LOGS_DIR = join(HOME, ".loop", "chat-logs");

export interface SessionLogEntry {
  type: "session_start" | "session_end" | "turn" | "signal";
  timestamp: string;
  [key: string]: unknown;
}

/**
 * SessionLogger — appends JSONL to a session file incrementally.
 * Each write is appendFileSync (crash-safe — no buffering).
 */
export class SessionLogger {
  private filepath: string;

  constructor(sessionId: string, sessionsDir?: string) {
    const dir = sessionsDir ?? CHAT_LOGS_DIR;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    this.filepath = join(dir, `${ts}_${sessionId}.jsonl`);
  }

  get path(): string {
    return this.filepath;
  }

  private append(entry: SessionLogEntry): void {
    appendFileSync(this.filepath, JSON.stringify(entry) + "\n", "utf-8");
  }

  logStart(metadata: { corpusDocs: number; persona?: string }): void {
    this.append({
      type: "session_start",
      timestamp: new Date().toISOString(),
      corpusDocs: metadata.corpusDocs,
      persona: metadata.persona ?? null,
    });
  }

  logTurn(role: "user" | "assistant", content: string, turn: number): void {
    this.append({
      type: "turn",
      timestamp: new Date().toISOString(),
      role,
      content,
      turn,
    });
  }

  logEnd(totalTurns: number, durationMs: number): void {
    this.append({
      type: "session_end",
      timestamp: new Date().toISOString(),
      totalTurns,
      durationMs,
    });
  }

  logSignal(signal: { signal: string; confidence: number; turn: number; detail: string }): void {
    this.append({
      type: "signal",
      timestamp: new Date().toISOString(),
      ...signal,
    });
  }
}
