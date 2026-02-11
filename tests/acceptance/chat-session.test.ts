import { describe, it, expect, beforeAll } from "vitest";
import { rmSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { ChatSession } from "../../src/core/chat-session.js";
import { backupConfig, restoreConfig } from "./helpers.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const LOOP_DIR = join(HOME, ".loop");
const CORPUS_DIR = join(LOOP_DIR, "corpus");

function ingestFixtures() {
  execSync("npx tsx src/index.ts ingest fixtures/", {
    encoding: "utf-8",
    timeout: 120_000,
  });
}

/**
 * Story 3.1: Interactive chat session
 *
 * Tests the ChatSession class directly (programmatic API).
 * Real LLM calls. No mocks. No readline.
 */
describe("Story 3.1: Interactive chat session", () => {
  beforeAll(() => {
    const cfg = backupConfig();
    rmSync(LOOP_DIR, { recursive: true, force: true });
    restoreConfig(cfg);
    ingestFixtures();
  }, 120_000);

  it("answers a single question with citation", async () => {
    const chat = new ChatSession();

    const r = await chat.send("What type of aircraft is MSN 4521?");

    expect(r.answer.toLowerCase()).toContain("b777");
    expect(r.turn).toBe(1);
    expect(r.role).toBe("assistant");

    await chat.end();
  }, 120_000);

  it("maintains context across turns (follow-up works)", async () => {
    const chat = new ChatSession();

    const r1 = await chat.send("What type of aircraft is MSN 4521?");
    expect(r1.answer.toLowerCase()).toContain("b777");

    // Follow-up — "that aircraft" requires context from turn 1
    const r2 = await chat.send(
      "What is the lease term for that aircraft?"
    );
    expect(r2.answer.toLowerCase()).toMatch(/12 years|twelve.*year|2021.*2033|2033.*2021/i);
    expect(r2.turn).toBe(2);

    // Verify turn tracking
    expect(chat.turnCount).toBe(2);
    expect(chat.turns.length).toBe(4); // 2 user + 2 assistant

    await chat.end();
  }, 240_000);

  it("end() returns session summary", async () => {
    const chat = new ChatSession();

    await chat.send("What type is MSN 4521?");
    const summary = await chat.end();

    expect(summary.id).toMatch(/^chat_/);
    expect(summary.totalTurns).toBe(1);
    expect(summary.duration).toBeGreaterThan(0);
    expect(summary.turns.length).toBe(2); // 1 user + 1 assistant
  }, 120_000);

  it("throws after session is ended", async () => {
    const chat = new ChatSession();
    await chat.send("What type is MSN 4521?");
    await chat.end();

    await expect(chat.send("follow up")).rejects.toThrow(/ended/i);
  }, 120_000);

  it("throws if corpus is empty", () => {
    const emptyDir = join(LOOP_DIR, "empty-corpus-test");
    expect(() => new ChatSession(emptyDir)).toThrow(/no documents/i);
  });
});
