/**
 * LLM Judge — builds a domain-specific judge prompt from eval run results.
 *
 * The grader (grader.ts) compares against ground truth.
 * The judge evaluates answer quality WITHOUT ground truth —
 * it learns what "good" and "bad" look like from labeled examples.
 *
 * Process:
 *   1. Take eval run results (pass/fail from grader or human review)
 *   2. Split 80/20 train/test
 *   3. Send train examples to LLM → generate judge prompt
 *   4. Test judge on held-out examples → report agreement %
 *   5. Save judge prompt to ~/.loop/eval/judge.md
 */

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  AuthStorage,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalRun, EvalResultEntry } from "./runner.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const EVAL_DIR = join(HOME, ".loop", "eval");
const SESSION_DIR = join(HOME, ".loop", "sessions", "judge");
const JUDGE_PATH = join(EVAL_DIR, "judge.md");

// ── Types ──

export interface JudgeResult {
  judgePath: string;
  judgePrompt: string;
  trainCount: number;
  testCount: number;
  agreement: number;       // 0-1
  testDetails: JudgeTestDetail[];
}

export interface JudgeTestDetail {
  id: string;
  question: string;
  humanLabel: boolean;     // pass/fail from eval run (treated as ground truth)
  judgeLabel: boolean;     // judge's verdict
  judgeReason: string;
  agree: boolean;
}

export interface JudgeVerdict {
  pass: boolean;
  reason: string;
}

// ── Create Judge ──

const JUDGE_CREATOR_PROMPT = `You are an expert at building evaluation criteria for document Q&A systems.

Given labeled examples of PASS and FAIL answers, write a judge prompt that can evaluate new answers the same way.

The judge prompt should:
1. Be specific to the domain and failure patterns you see in the examples
2. Include clear PASS criteria and FAIL criteria
3. Include 2-3 few-shot examples showing both PASS and FAIL verdicts
4. End with instructions to output exactly: PASS: <reason> or FAIL: <reason>

Write ONLY the judge prompt. No preamble. Start directly with the prompt text.`;

/**
 * Create an LLM judge from an eval run's results.
 *
 * @param run - The eval run with graded results
 * @param minExamples - Minimum labeled examples required (default 10)
 * @returns JudgeResult with agreement stats
 */
export async function createJudge(
  run: EvalRun,
  minExamples: number = 10,
): Promise<JudgeResult> {
  const results = run.results;

  if (results.length < minExamples) {
    throw new Error(
      `Need at least ${minExamples} graded examples to build a judge. Got ${results.length}. ` +
      `Run a larger eval first: loop eval --benchmark custom`,
    );
  }

  // Need both pass and fail examples
  const passes = results.filter((r) => r.pass);
  const failures = results.filter((r) => !r.pass);

  if (passes.length === 0) {
    throw new Error("Need at least some PASS examples to build a judge. All results are failures.");
  }
  if (failures.length === 0) {
    throw new Error("Need at least some FAIL examples to build a judge. All results are passes.");
  }

  // 80/20 split (shuffle first for randomness)
  const shuffled = [...results].sort(() => Math.random() - 0.5);
  const splitIdx = Math.max(1, Math.floor(shuffled.length * 0.8));
  const trainSet = shuffled.slice(0, splitIdx);
  const testSet = shuffled.slice(splitIdx);

  // Ensure test set has at least 1 item
  if (testSet.length === 0) {
    // Move last train item to test
    testSet.push(trainSet.pop()!);
  }

  // Step 1: Generate judge prompt from train examples
  const judgePrompt = await generateJudgePrompt(trainSet);

  // Step 2: Test judge on held-out examples
  const testDetails = await testJudge(judgePrompt, testSet);

  // Step 3: Calculate agreement
  const agreeCount = testDetails.filter((d) => d.agree).length;
  const agreement = testDetails.length > 0 ? agreeCount / testDetails.length : 0;

  // Step 4: Save judge prompt
  if (!existsSync(EVAL_DIR)) mkdirSync(EVAL_DIR, { recursive: true });
  writeFileSync(JUDGE_PATH, judgePrompt, "utf-8");

  return {
    judgePath: JUDGE_PATH,
    judgePrompt,
    trainCount: trainSet.length,
    testCount: testSet.length,
    agreement,
    testDetails,
  };
}

// ── Generate Judge Prompt ──

async function generateJudgePrompt(trainExamples: EvalResultEntry[]): Promise<string> {
  const examplesText = trainExamples.map((r) => {
    const label = r.pass ? "PASS" : "FAIL";
    return `Question: ${r.question}
Answer: ${truncate(r.actualAnswer, 300)}
Expected: ${r.expectedAnswer}
Label: ${label}
Reason: ${r.reason}`;
  }).join("\n\n---\n\n");

  const prompt = `Here are ${trainExamples.length} labeled examples from a document Q&A system evaluation.
Study the patterns — what makes a PASS, what makes a FAIL.
Then write a judge prompt that can evaluate new question/answer pairs.

${examplesText}

Write the judge prompt now:`;

  return await llmCall(JUDGE_CREATOR_PROMPT, prompt);
}

// ── Test Judge ──

async function testJudge(
  judgePrompt: string,
  testExamples: EvalResultEntry[],
): Promise<JudgeTestDetail[]> {
  const details: JudgeTestDetail[] = [];

  for (const example of testExamples) {
    const verdict = await runJudge(judgePrompt, example.question, example.actualAnswer);

    details.push({
      id: example.id,
      question: example.question,
      humanLabel: example.pass,
      judgeLabel: verdict.pass,
      judgeReason: verdict.reason,
      agree: example.pass === verdict.pass,
    });
  }

  return details;
}

// ── Run Judge ──

/**
 * Run the judge on a single question/answer pair.
 * Can be called with a saved judge prompt or a custom one.
 */
export async function runJudge(
  judgePrompt: string,
  question: string,
  answer: string,
): Promise<JudgeVerdict> {
  const prompt = `Question: ${question}
Answer: ${answer}

Verdict:`;

  const response = await llmCall(judgePrompt, prompt);
  return parseJudgeVerdict(response);
}

/**
 * Load the saved judge prompt from disk.
 * Returns null if no judge has been created yet.
 */
export function loadJudgePrompt(): string | null {
  if (!existsSync(JUDGE_PATH)) return null;
  return readFileSync(JUDGE_PATH, "utf-8");
}

// ── LLM Call Helper ──

async function llmCall(systemPrompt: string, userPrompt: string): Promise<string> {
  const authStorage = new AuthStorage();
  const modelRegistry = new ModelRegistry(authStorage);

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 2 },
  });

  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    settingsManager,
    systemPromptOverride: () => systemPrompt,
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  mkdirSync(SESSION_DIR, { recursive: true });
  const sessionManager = SessionManager.create(process.cwd(), SESSION_DIR);

  const { loadConfig } = await import("../core/config.js");
  let model: any;
  const cm = loadConfig().model;
  if (cm) { const si = cm.indexOf("/"); if (si > 0) model = modelRegistry.find(cm.substring(0, si), cm.substring(si + 1)); }

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

  await session.prompt(userPrompt);
  unsubscribe();
  session.dispose();

  return response.trim();
}

// ── Parse Judge Verdict ──

function parseJudgeVerdict(response: string): JudgeVerdict {
  const trimmed = response.trim();

  const passMatch = trimmed.match(/^PASS:\s*(.+)/im);
  if (passMatch) {
    return { pass: true, reason: passMatch[1].trim() };
  }

  const failMatch = trimmed.match(/^FAIL:\s*(.+)/im);
  if (failMatch) {
    return { pass: false, reason: failMatch[1].trim() };
  }

  // Fallback
  if (/\bpass\b/i.test(trimmed)) {
    return { pass: true, reason: trimmed.slice(0, 200) };
  }
  if (/\bfail\b/i.test(trimmed)) {
    return { pass: false, reason: trimmed.slice(0, 200) };
  }

  return { pass: false, reason: `Unparseable verdict: ${trimmed.slice(0, 200)}` };
}

// ── Helpers ──

function truncate(s: string, max: number): string {
  const clean = s.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + "…";
}
