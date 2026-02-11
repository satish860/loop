import { describe, it, expect, beforeAll } from "vitest";
import { rmSync, existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { ChatSession } from "../../src/core/chat-session.js";
import { CHAT_LOGS_DIR as SESSIONS_DIR } from "../../src/core/session-logger.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const LOOP_DIR = join(HOME, ".loop");

function ingestFixtures() {
  execSync("npx tsx src/index.ts ingest fixtures/", {
    encoding: "utf-8",
    timeout: 120_000,
  });
}

function readSessionLog(filepath: string): Record<string, unknown>[] {
  return readFileSync(filepath, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

/**
 * Story 3.2: Chat session logging
 *
 * Every chat exchange is logged to ~/.loop/sessions/ as JSONL.
 * Logs written incrementally (crash-safe).
 */
describe("Story 3.2: Chat session logging", () => {
  beforeAll(() => {
    rmSync(LOOP_DIR, { recursive: true, force: true });
    ingestFixtures();
  }, 120_000);

  it("creates a session log file with correct structure", async () => {
    const chat = new ChatSession();
    await chat.send("What is the lease term for MSN 4521?");
    await chat.send("What about the reserve rate?");
    await chat.end();

    // Session file exists (use session's own logPath — parallel-safe)
    const logFile = chat.logPath;
    expect(existsSync(logFile)).toBe(true);

    // Parse JSONL
    const lines = readSessionLog(logFile);

    // First line is session_start
    expect(lines[0].type).toBe("session_start");
    expect(lines[0].corpusDocs).toBeGreaterThan(0);

    // Last line is session_end
    const last = lines[lines.length - 1];
    expect(last.type).toBe("session_end");
    expect(last.totalTurns).toBe(2);
    expect((last.durationMs as number)).toBeGreaterThan(0);

    // Turn lines: 2 user + 2 assistant = 4 turn entries
    const turns = lines.filter((l) => l.type === "turn");
    expect(turns.length).toBe(4);

    const userTurns = turns.filter((t) => t.role === "user");
    const assistantTurns = turns.filter((t) => t.role === "assistant");
    expect(userTurns.length).toBe(2);
    expect(assistantTurns.length).toBe(2);

    // Content captured
    expect(userTurns[0].content).toContain("lease term");
    expect((assistantTurns[0].content as string).length).toBeGreaterThan(0);
  }, 240_000);

  it("each line is valid JSON (valid JSONL format)", async () => {
    // Create a fresh session for this test
    const chat = new ChatSession();
    await chat.send("What type is MSN 4521?");
    await chat.end();

    const raw = readFileSync(chat.logPath, "utf-8").trim();
    const lines = raw.split("\n");

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  }, 120_000);

  it("writes incrementally — file exists before session ends", async () => {
    const chat = new ChatSession();
    await chat.send("What type is MSN 4521?");

    // File should exist BEFORE end() is called (use logPath — parallel-safe)
    const logFile = chat.logPath;
    expect(existsSync(logFile)).toBe(true);

    // Should have at least session_start + user + assistant = 3 lines
    const raw = readFileSync(logFile, "utf-8").trim();
    const lineCount = raw.split("\n").length;
    expect(lineCount).toBeGreaterThanOrEqual(3);

    // No session_end yet
    const lines = raw.split("\n").map((l) => JSON.parse(l));
    const endLines = lines.filter((l) => l.type === "session_end");
    expect(endLines.length).toBe(0);

    await chat.end();

    // Now session_end should exist
    const rawAfter = readFileSync(logFile, "utf-8").trim();
    const linesAfter = rawAfter.split("\n").map((l) => JSON.parse(l));
    const endLinesAfter = linesAfter.filter((l) => l.type === "session_end");
    expect(endLinesAfter.length).toBe(1);
  }, 120_000);

  it("each session gets its own file", async () => {
    const chat1 = new ChatSession();
    await chat1.send("What type is MSN 4521?");
    await chat1.end();

    const chat2 = new ChatSession();
    await chat2.send("What is the lease term?");
    await chat2.end();

    // Each session has its own unique log file (parallel-safe check)
    expect(chat1.logPath).not.toBe(chat2.logPath);
    expect(existsSync(chat1.logPath)).toBe(true);
    expect(existsSync(chat2.logPath)).toBe(true);
  }, 240_000);
});
