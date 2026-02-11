/**
 * Eval Grader — LLM-based semantic answer comparison.
 *
 * Compares actual answer against expected answer for a given question.
 * Returns binary pass/fail + one-line reason.
 * Uses a lightweight Pi session (no tools needed — just comparison).
 */

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  AuthStorage,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const SESSION_DIR = join(HOME, ".loop", "sessions", "grader");

const GRADER_SYSTEM_PROMPT = `You are a strict grading assistant. You compare an actual answer to an expected answer for a given question.

Rules:
- PASS if the actual answer contains the key information from the expected answer
- PASS if numbers match (allow minor rounding differences, e.g., 25.6% vs 25.56%)
- PASS if the actual answer provides MORE detail than expected, as long as the core fact is correct
- FAIL if the actual answer has the WRONG value or contradicts the expected answer
- FAIL if the actual answer says "I don't know" or "not found" but the expected answer has real information
- FAIL if the actual answer cites a different/wrong source than what the expected answer implies
- FAIL if the actual answer hallucinates information not supported by the expected answer
- For "not_answerable" questions: PASS if actual answer correctly says it can't find the info

Respond with EXACTLY one line in this format:
PASS: <brief reason>
or
FAIL: <brief reason>

Nothing else. One line only.`;

export interface GradeResult {
  pass: boolean;
  reason: string;
}

/**
 * Grade a single answer against expected answer using LLM comparison.
 */
export async function gradeAnswer(
  question: string,
  expectedAnswer: string,
  actualAnswer: string,
): Promise<GradeResult> {
  const authStorage = new AuthStorage();
  const modelRegistry = new ModelRegistry(authStorage);

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 2 },
  });

  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    settingsManager,
    systemPromptOverride: () => GRADER_SYSTEM_PROMPT,
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  mkdirSync(SESSION_DIR, { recursive: true });
  const sessionManager = SessionManager.create(process.cwd(), SESSION_DIR);

  // Resolve configured model
  const { loadConfig } = await import("../core/config.js");
  let model: any;
  const configuredModel = loadConfig().model;
  if (configuredModel) {
    const si = configuredModel.indexOf("/");
    if (si > 0) model = modelRegistry.find(configuredModel.substring(0, si), configuredModel.substring(si + 1));
  }

  const { session } = await createAgentSession({
    cwd: process.cwd(),
    tools: [],
    resourceLoader: loader,
    sessionManager,
    settingsManager,
    authStorage,
    modelRegistry,
    ...(model ? { model } : {}),
  });

  let response = "";
  const unsubscribe = session.subscribe((event) => {
    if (
      event.type === "message_update" &&
      (event as any).assistantMessageEvent?.type === "text_delta"
    ) {
      response += (event as any).assistantMessageEvent.delta;
    }
  });

  const prompt = `Question: ${question}

Expected Answer: ${expectedAnswer}

Actual Answer: ${actualAnswer}

Grade:`;

  await session.prompt(prompt);
  unsubscribe();
  session.dispose();

  return parseGradeResponse(response);
}

/**
 * Parse the grader's response into a structured result.
 */
function parseGradeResponse(response: string): GradeResult {
  const trimmed = response.trim();

  // Look for PASS: or FAIL: pattern
  const passMatch = trimmed.match(/^PASS:\s*(.+)/im);
  if (passMatch) {
    return { pass: true, reason: passMatch[1].trim() };
  }

  const failMatch = trimmed.match(/^FAIL:\s*(.+)/im);
  if (failMatch) {
    return { pass: false, reason: failMatch[1].trim() };
  }

  // Fallback: look for pass/fail anywhere in response
  if (/\bpass\b/i.test(trimmed)) {
    return { pass: true, reason: trimmed.slice(0, 200) };
  }
  if (/\bfail\b/i.test(trimmed)) {
    return { pass: false, reason: trimmed.slice(0, 200) };
  }

  // Default: if we can't parse, mark as fail with the raw response
  return { pass: false, reason: `Unparseable grader response: ${trimmed.slice(0, 200)}` };
}
