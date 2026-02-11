/**
 * Story 5.6: Mine Chat Logs for QA Pairs — acceptance tests
 *
 * Tests:
 *   1. Empty logs dir returns empty result
 *   2. Extracts QA pairs from user-assistant turns
 *   3. Corrections flagged as high-value with corrected answer
 *   4. Satisfied turns flagged as medium-value
 *   5. Short/non-question turns skipped
 *   6. minedToQAPairs deduplicates against existing benchmark
 *   7. minedToQAPairs formats as valid QAPair objects
 *   8. Real chat session produces mineable pairs
 */

import { describe, test, expect, beforeEach, afterAll } from "vitest";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mineChatsForQA, minedToQAPairs, type MinedPair } from "../../src/eval/chat-miner.js";
import type { QAPair } from "../../src/core/qa-generator.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const TEST_LOGS_DIR = join(HOME, ".loop", "test-chat-logs");

function cleanup(): void {
  if (existsSync(TEST_LOGS_DIR)) rmSync(TEST_LOGS_DIR, { recursive: true });
}

/** Write a synthetic chat session JSONL */
function writeSession(filename: string, entries: object[]): void {
  if (!existsSync(TEST_LOGS_DIR)) mkdirSync(TEST_LOGS_DIR, { recursive: true });
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(join(TEST_LOGS_DIR, filename), content, "utf-8");
}

describe("Story 5.6: Mine Chat Logs", () => {
  beforeEach(() => cleanup());
  afterAll(() => cleanup());

  test("empty logs dir returns empty result", () => {
    const result = mineChatsForQA(TEST_LOGS_DIR);
    expect(result.pairs.length).toBe(0);
    expect(result.sessionsScanned).toBe(0);
    expect(result.turnsScanned).toBe(0);
  });

  test("nonexistent dir returns empty result", () => {
    const result = mineChatsForQA("/nonexistent/path");
    expect(result.pairs.length).toBe(0);
    expect(result.sessionsScanned).toBe(0);
  });

  test("extracts QA pairs from user-assistant turns", () => {
    writeSession("session1.jsonl", [
      { type: "session_start", timestamp: "2026-02-11T10:00:00Z" },
      { type: "turn", role: "user", content: "What type of aircraft is MSN 4521?", turn: 1 },
      { type: "turn", role: "assistant", content: "MSN 4521 is a B777-300ER", turn: 2 },
      { type: "session_end", timestamp: "2026-02-11T10:05:00Z", totalTurns: 2, durationMs: 300000 },
    ]);

    const result = mineChatsForQA(TEST_LOGS_DIR);

    expect(result.sessionsScanned).toBe(1);
    expect(result.pairs.length).toBe(1);
    expect(result.pairs[0].question).toContain("MSN 4521");
    expect(result.pairs[0].answer).toContain("B777-300ER");
    expect(result.pairs[0].source).toBe("chat_qa");
  });

  test("corrections flagged as high-value with corrected answer", () => {
    writeSession("correction.jsonl", [
      { type: "session_start", timestamp: "2026-02-11T10:00:00Z" },
      { type: "turn", role: "user", content: "What is the engine reserve for MSN 4521?", turn: 1 },
      { type: "turn", role: "assistant", content: "$350 per flight hour", turn: 2 },
      { type: "turn", role: "user", content: "No, that's wrong. It should be $420 per the amendment", turn: 3 },
      { type: "turn", role: "assistant", content: "You're right, $420/FH per the amendment", turn: 4 },
      { type: "session_end", timestamp: "2026-02-11T10:05:00Z", totalTurns: 4, durationMs: 300000 },
    ]);

    const result = mineChatsForQA(TEST_LOGS_DIR);

    const correction = result.pairs.find((p) => p.source === "chat_correction");
    expect(correction).toBeDefined();
    expect(correction!.question).toContain("engine reserve");
    expect(correction!.correctedAnswer).toBeTruthy();
    expect(correction!.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.corrections).toBeGreaterThanOrEqual(1);
  });

  test("satisfaction flagged as medium-value", () => {
    writeSession("satisfied.jsonl", [
      { type: "session_start", timestamp: "2026-02-11T10:00:00Z" },
      { type: "turn", role: "user", content: "What is the lease term for MSN 4521?", turn: 1 },
      { type: "turn", role: "assistant", content: "12 years", turn: 2 },
      { type: "turn", role: "user", content: "Thanks, that's exactly what I needed", turn: 3 },
      { type: "session_end", timestamp: "2026-02-11T10:05:00Z", totalTurns: 3, durationMs: 300000 },
    ]);

    const result = mineChatsForQA(TEST_LOGS_DIR);

    const satisfied = result.pairs.find((p) => p.source === "chat_satisfied");
    expect(satisfied).toBeDefined();
    expect(satisfied!.question).toContain("lease term");
    expect(satisfied!.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.satisfied).toBeGreaterThanOrEqual(1);
  });

  test("short and non-question turns skipped", () => {
    writeSession("greetings.jsonl", [
      { type: "session_start", timestamp: "2026-02-11T10:00:00Z" },
      { type: "turn", role: "user", content: "Hi", turn: 1 },
      { type: "turn", role: "assistant", content: "Hello! How can I help?", turn: 2 },
      { type: "turn", role: "user", content: "ok", turn: 3 },
      { type: "turn", role: "assistant", content: "Let me know if you need anything", turn: 4 },
      { type: "session_end", timestamp: "2026-02-11T10:05:00Z", totalTurns: 4, durationMs: 300000 },
    ]);

    const result = mineChatsForQA(TEST_LOGS_DIR);

    expect(result.pairs.length).toBe(0);
  });

  test("minedToQAPairs deduplicates against existing benchmark", () => {
    const mined: MinedPair[] = [
      { question: "What type is MSN 4521?", answer: "B777-300ER", source: "chat_qa", sessionFile: "s1.jsonl", turnNumber: 1, confidence: 0.5 },
      { question: "Who is the lessee?", answer: "Emirates", source: "chat_qa", sessionFile: "s1.jsonl", turnNumber: 3, confidence: 0.5 },
    ];

    const existing: QAPair[] = [
      { id: "q1", question: "What type is MSN 4521?", expectedAnswer: "B777-300ER", source: "test", dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "excel" }, status: "keep" },
    ];

    const result = minedToQAPairs(mined, existing);

    // Only the non-duplicate should remain
    expect(result.length).toBe(1);
    expect(result[0].question).toContain("lessee");
  });

  test("minedToQAPairs formats as valid QAPair objects", () => {
    const mined: MinedPair[] = [
      { question: "What is the engine reserve?", answer: "$350/FH", source: "chat_correction", sessionFile: "s1.jsonl", turnNumber: 1, confidence: 0.9, correctedAnswer: "$420/FH per the amendment" },
      { question: "Who is the lessee?", answer: "Emirates Airlines", source: "chat_satisfied", sessionFile: "s1.jsonl", turnNumber: 3, confidence: 0.7 },
    ];

    const result = minedToQAPairs(mined);

    expect(result.length).toBe(2);

    // Correction uses corrected answer as expected
    expect(result[0].expectedAnswer).toBe("$420/FH per the amendment");
    expect(result[0].id).toMatch(/^chat-\d{3}$/);
    expect(result[0].status).toBe("keep");
    expect(result[0].dimensions).toBeDefined();

    // Satisfied uses original answer as expected
    expect(result[1].expectedAnswer).toBe("Emirates Airlines");
  });

  test("multiple sessions mined together", () => {
    writeSession("s1.jsonl", [
      { type: "session_start", timestamp: "2026-02-11T10:00:00Z" },
      { type: "turn", role: "user", content: "What type of aircraft is MSN 4521?", turn: 1 },
      { type: "turn", role: "assistant", content: "B777-300ER", turn: 2 },
      { type: "session_end", timestamp: "2026-02-11T10:05:00Z", totalTurns: 2, durationMs: 300000 },
    ]);
    writeSession("s2.jsonl", [
      { type: "session_start", timestamp: "2026-02-11T11:00:00Z" },
      { type: "turn", role: "user", content: "Who is the lessee for MSN 4521?", turn: 1 },
      { type: "turn", role: "assistant", content: "Emirates Airlines", turn: 2 },
      { type: "session_end", timestamp: "2026-02-11T11:05:00Z", totalTurns: 2, durationMs: 300000 },
    ]);

    const result = mineChatsForQA(TEST_LOGS_DIR);

    expect(result.sessionsScanned).toBe(2);
    expect(result.pairs.length).toBe(2);
  });
});
