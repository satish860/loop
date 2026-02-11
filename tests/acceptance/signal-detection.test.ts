import { describe, it, expect, beforeAll } from "vitest";
import { rmSync, existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { ChatSession } from "../../src/core/chat-session.js";
import { analyzeSession, detectSignals } from "../../src/core/signal-detector.js";
import { CHAT_LOGS_DIR } from "../../src/core/session-logger.js";
import { backupConfig, restoreConfig } from "./helpers.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const LOOP_DIR = join(HOME, ".loop");

function ingestFixtures() {
  execSync("npx tsx src/index.ts ingest fixtures/", {
    encoding: "utf-8",
    timeout: 120_000,
  });
}

/**
 * Story 3.3: Implicit signal detection
 *
 * Detects corrections, reformulations, satisfaction, and follow-up depth
 * from chat session logs. Runs post-session. No mocks.
 */
describe("Story 3.3: Implicit signal detection", () => {
  beforeAll(() => {
    const cfg = backupConfig();
    rmSync(LOOP_DIR, { recursive: true, force: true });
    restoreConfig(cfg);
    ingestFixtures();
  }, 120_000);

  // ── Core detection tests (pattern-based, no LLM needed) ──

  describe("detectSignals (unit-level patterns)", () => {
    it("detects correction: 'that's wrong'", () => {
      const entries = [
        { type: "turn", role: "user", content: "What is the engine reserve?", turn: 1 },
        { type: "turn", role: "assistant", content: "$350 per flight hour", turn: 1 },
        { type: "turn", role: "user", content: "That's wrong, the amendment changed it to $420", turn: 2 },
        { type: "turn", role: "assistant", content: "I apologize...", turn: 2 },
      ];

      const signals = detectSignals(entries);
      const corrections = signals.filter((s) => s.signal === "correction");
      expect(corrections.length).toBe(1);
      expect(corrections[0].turn).toBe(2);
      expect(corrections[0].confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("detects correction: 'no, actually it's...'", () => {
      const entries = [
        { type: "turn", role: "user", content: "What type is MSN 4521?", turn: 1 },
        { type: "turn", role: "assistant", content: "A320", turn: 1 },
        { type: "turn", role: "user", content: "No, actually it's a B777-300ER", turn: 2 },
      ];

      const signals = detectSignals(entries);
      const corrections = signals.filter((s) => s.signal === "correction");
      expect(corrections.length).toBe(1);
    });

    it("detects correction: 'it should be'", () => {
      const entries = [
        { type: "turn", role: "user", content: "What is the lease start date?", turn: 1 },
        { type: "turn", role: "assistant", content: "January 2020", turn: 1 },
        { type: "turn", role: "user", content: "It should be March 2020", turn: 2 },
      ];

      const signals = detectSignals(entries);
      const corrections = signals.filter((s) => s.signal === "correction");
      expect(corrections.length).toBe(1);
    });

    it("detects satisfaction: 'thanks'", () => {
      const entries = [
        { type: "turn", role: "user", content: "What is the lease term?", turn: 1 },
        { type: "turn", role: "assistant", content: "12 years", turn: 1 },
        { type: "turn", role: "user", content: "Thanks, that's helpful", turn: 2 },
      ];

      const signals = detectSignals(entries);
      const satisfactions = signals.filter((s) => s.signal === "satisfaction");
      expect(satisfactions.length).toBe(1);
      expect(satisfactions[0].turn).toBe(2);
    });

    it("detects satisfaction: 'perfect'", () => {
      const entries = [
        { type: "turn", role: "user", content: "Who is the lessee?", turn: 1 },
        { type: "turn", role: "assistant", content: "Emirates", turn: 1 },
        { type: "turn", role: "user", content: "Perfect!", turn: 2 },
      ];

      const signals = detectSignals(entries);
      const satisfactions = signals.filter((s) => s.signal === "satisfaction");
      expect(satisfactions.length).toBe(1);
    });

    it("detects reformulation: user re-asks similarly worded question", () => {
      const entries = [
        { type: "turn", role: "user", content: "What is the engine maintenance reserve rate?", turn: 1 },
        { type: "turn", role: "assistant", content: "I couldn't find that.", turn: 1 },
        { type: "turn", role: "user", content: "What is the maintenance reserve rate for the engine?", turn: 2 },
      ];

      const signals = detectSignals(entries);
      const reformulations = signals.filter((s) => s.signal === "reformulation");
      expect(reformulations.length).toBe(1);
      expect(reformulations[0].turn).toBe(2);
    });

    it("detects follow-up depth: 3+ turns", () => {
      const entries = [
        { type: "turn", role: "user", content: "What type is MSN 4521?", turn: 1 },
        { type: "turn", role: "assistant", content: "B777-300ER", turn: 1 },
        { type: "turn", role: "user", content: "Who is the lessee?", turn: 2 },
        { type: "turn", role: "assistant", content: "Emirates", turn: 2 },
        { type: "turn", role: "user", content: "What is the lease term?", turn: 3 },
        { type: "turn", role: "assistant", content: "12 years", turn: 3 },
      ];

      const signals = detectSignals(entries);
      const depth = signals.filter((s) => s.signal === "follow_up_depth");
      expect(depth.length).toBe(1);
      expect(depth[0].detail).toContain("3 turns");
    });

    it("does NOT detect follow-up depth for short sessions", () => {
      const entries = [
        { type: "turn", role: "user", content: "What type is MSN 4521?", turn: 1 },
        { type: "turn", role: "assistant", content: "B777-300ER", turn: 1 },
      ];

      const signals = detectSignals(entries);
      const depth = signals.filter((s) => s.signal === "follow_up_depth");
      expect(depth.length).toBe(0);
    });

    it("does NOT flag normal questions as corrections", () => {
      const entries = [
        { type: "turn", role: "user", content: "What is the lease term?", turn: 1 },
        { type: "turn", role: "assistant", content: "12 years", turn: 1 },
        { type: "turn", role: "user", content: "What is the reserve rate?", turn: 2 },
      ];

      const signals = detectSignals(entries);
      const corrections = signals.filter((s) => s.signal === "correction");
      expect(corrections.length).toBe(0);
    });

    it("detects multiple signals in one session", () => {
      const entries = [
        { type: "turn", role: "user", content: "What is the engine reserve?", turn: 1 },
        { type: "turn", role: "assistant", content: "$350/FH", turn: 1 },
        { type: "turn", role: "user", content: "That's wrong, it's $420", turn: 2 },
        { type: "turn", role: "assistant", content: "I apologize...", turn: 2 },
        { type: "turn", role: "user", content: "What is the lease term?", turn: 3 },
        { type: "turn", role: "assistant", content: "12 years", turn: 3 },
        { type: "turn", role: "user", content: "Thanks!", turn: 4 },
      ];

      const signals = detectSignals(entries);

      const corrections = signals.filter((s) => s.signal === "correction");
      const satisfactions = signals.filter((s) => s.signal === "satisfaction");
      const depth = signals.filter((s) => s.signal === "follow_up_depth");

      expect(corrections.length).toBe(1);
      expect(satisfactions.length).toBe(1);
      expect(depth.length).toBe(1);
    });
  });

  // ── Integration test: real chat with correction signal ──

  describe("real chat signal detection", () => {
    it("detects correction signal from real chat session", async () => {
      // Clear sessions dir
      if (existsSync(CHAT_LOGS_DIR))
        rmSync(CHAT_LOGS_DIR, { recursive: true, force: true });

      const session = new ChatSession();

      await session.send("What is the engine reserve?");
      // User corrects the answer
      await session.send("That's wrong, the amendment changed it to $420");

      const summary = await session.end();

      // Signals detected in summary
      const corrections = summary.signals.filter((s) => s.signal === "correction");
      expect(corrections.length).toBe(1);
      expect(corrections[0].confidence).toBeGreaterThanOrEqual(0.5);

      // Signals also logged to session file
      const logFile = session.logPath;
      const raw = readFileSync(logFile, "utf-8").trim();
      const lines = raw.split("\n").map((l) => JSON.parse(l));

      const signalEntries = lines.filter((l) => l.type === "signal");
      expect(signalEntries.length).toBeGreaterThanOrEqual(1);
      expect(signalEntries.some((s) => s.signal === "correction")).toBe(true);
    }, 240_000);

    it("detects satisfaction signal from real chat", async () => {
      if (existsSync(CHAT_LOGS_DIR))
        rmSync(CHAT_LOGS_DIR, { recursive: true, force: true });

      const session = new ChatSession();

      await session.send("What type of aircraft is MSN 4521?");
      await session.send("Thanks, that's perfect!");

      const summary = await session.end();

      const satisfactions = summary.signals.filter((s) => s.signal === "satisfaction");
      expect(satisfactions.length).toBe(1);
    }, 240_000);

    it("analyzeSession() works with session ID", async () => {
      if (existsSync(CHAT_LOGS_DIR))
        rmSync(CHAT_LOGS_DIR, { recursive: true, force: true });

      const session = new ChatSession();

      await session.send("What is the engine reserve rate?");
      await session.send("That's incorrect, it should be $420/FH");
      await session.send("Great, thanks!");

      await session.end();

      // Use the public analyzeSession API
      const signals = analyzeSession(session.id);

      const corrections = signals.filter((s) => s.signal === "correction");
      const satisfactions = signals.filter((s) => s.signal === "satisfaction");
      const depth = signals.filter((s) => s.signal === "follow_up_depth");

      expect(corrections.length).toBe(1);
      expect(satisfactions.length).toBe(1);
      expect(depth.length).toBe(1); // 3 turns
    }, 240_000);
  });
});
