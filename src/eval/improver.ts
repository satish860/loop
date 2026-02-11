/**
 * System Prompt Improver — ACE-inspired (Reflector → Curator → Tester).
 *
 * 1. Reflector: Studies failures from worst dimension, writes critiques
 * 2. Curator: Proposes delta addition to system prompt
 * 3. Tester: Re-runs failed queries with new prompt, checks regressions
 * 4. Apply: Saves improved prompt to ~/.loop/system.md + logs improvement
 */

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  AuthStorage,
  ModelRegistry,
  createReadOnlyTools,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { CorpusManager } from "../core/corpus.js";
import { buildSystemPrompt } from "../core/session.js";
import { resolvePersona } from "../core/config.js";
import { gradeAnswer } from "./grader.js";
import { analyzeByDimension, type WorstDimension } from "./analyzer.js";
import type { EvalRun, EvalResultEntry } from "./runner.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const EVAL_DIR = join(HOME, ".loop", "eval");
const SYSTEM_PROMPT_PATH = join(HOME, ".loop", "system.md");
const IMPROVEMENTS_PATH = join(EVAL_DIR, "improvements.jsonl");
const SESSION_DIR = join(HOME, ".loop", "sessions", "improver");

// ── Types ──

export interface Improvement {
  targetDimension: string;
  targetValue: string;
  reflections: string;
  proposedDelta: string;
  beforeAccuracy: number;
  afterAccuracy: number;
  failuresBefore: number;
  failuresAfter: number;
  regressions: RegressionDetail[];
  passTestResults: TestResult[];
  failTestResults: TestResult[];
}

export interface TestResult {
  id: string;
  question: string;
  expectedAnswer: string;
  actualAnswer: string;
  pass: boolean;
  reason: string;
}

export interface RegressionDetail {
  id: string;
  question: string;
  reason: string;
}

export interface ImprovementLog {
  timestamp: string;
  runId: string;
  targetDimension: string;
  targetValue: string;
  delta: string;
  beforeAccuracy: number;
  afterAccuracy: number;
  regressions: number;
  applied: boolean;
}

// ── Suggest Improvement ──

/**
 * Analyze an eval run's worst dimension and suggest a system prompt improvement.
 *
 * @param run - The eval run to improve on
 * @param onProgress - Progress callback for UI
 */
export async function suggestImprovement(
  run: EvalRun,
  onProgress?: (step: string) => void,
): Promise<Improvement> {
  // Step 0: Check for failures
  const allFailures = run.results.filter((r) => !r.pass);
  if (allFailures.length === 0) {
    throw new Error("No failures found in this eval run. Nothing to improve.");
  }

  // Find worst dimension
  const analysis = analyzeByDimension(run);
  if (!analysis.worst || analysis.worst.failures.length === 0) {
    throw new Error("No failures found in this eval run. Nothing to improve.");
  }

  const worst = analysis.worst;
  const failures = worst.failures;
  const passes = run.results.filter((r) => r.pass);

  onProgress?.(`Worst dimension: ${worst.value} (${worst.dimension}) @ ${(worst.accuracy * 100).toFixed(0)}%`);

  // Step 1: REFLECTOR — study failures and write critiques
  onProgress?.("Reflecting on failures...");
  const reflections = await reflect(failures);

  // Step 2: CURATOR — propose delta to system prompt
  onProgress?.("Proposing system prompt improvement...");
  const currentPrompt = getCurrentSystemPrompt();
  const proposedDelta = await curate(currentPrompt, reflections, worst);

  // Step 3: TEST on failures — does the fix help?
  onProgress?.("Testing on failed queries...");
  const newPrompt = currentPrompt + "\n\n" + proposedDelta;
  const failTestResults = await testPairs(failures, newPrompt);
  const failPassCount = failTestResults.filter((r) => r.pass).length;

  // Step 4: REGRESSION CHECK — re-run on a sample of passing queries
  onProgress?.("Checking for regressions...");
  // Test up to 5 passing queries (cost control)
  const passSample = passes.slice(0, Math.min(5, passes.length));
  const passTestResults = await testPairs(
    passSample.map((r) => ({
      id: r.id,
      question: r.question,
      expectedAnswer: r.expectedAnswer,
      actualAnswer: r.actualAnswer,
      reason: r.reason,
    })),
    newPrompt,
  );
  const regressions = passTestResults
    .filter((r) => !r.pass)
    .map((r) => ({ id: r.id, question: r.question, reason: r.reason }));

  const beforeAccuracy = worst.accuracy;
  const afterAccuracy = failures.length > 0 ? failPassCount / failures.length : 0;

  return {
    targetDimension: worst.dimension,
    targetValue: worst.value,
    reflections,
    proposedDelta,
    beforeAccuracy,
    afterAccuracy,
    failuresBefore: failures.length,
    failuresAfter: failures.length - failPassCount,
    regressions,
    passTestResults,
    failTestResults,
  };
}

// ── Apply Improvement ──

/**
 * Apply an improvement — saves new system prompt and logs the change.
 */
export function applyImprovement(
  improvement: Improvement,
  runId: string,
): void {
  const currentPrompt = getCurrentSystemPrompt();
  const newPrompt = currentPrompt + "\n\n" + improvement.proposedDelta;

  // Save improved prompt
  writeFileSync(SYSTEM_PROMPT_PATH, newPrompt, "utf-8");

  // Log improvement
  if (!existsSync(EVAL_DIR)) mkdirSync(EVAL_DIR, { recursive: true });

  const log: ImprovementLog = {
    timestamp: new Date().toISOString(),
    runId,
    targetDimension: improvement.targetDimension,
    targetValue: improvement.targetValue,
    delta: improvement.proposedDelta,
    beforeAccuracy: improvement.beforeAccuracy,
    afterAccuracy: improvement.afterAccuracy,
    regressions: improvement.regressions.length,
    applied: true,
  };

  appendFileSync(IMPROVEMENTS_PATH, JSON.stringify(log) + "\n", "utf-8");
}

/**
 * Load improvement history.
 */
export function loadImprovements(): ImprovementLog[] {
  if (!existsSync(IMPROVEMENTS_PATH)) return [];
  return readFileSync(IMPROVEMENTS_PATH, "utf-8")
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/**
 * Get the current system prompt (from file or hardcoded default).
 */
export function getCurrentSystemPrompt(): string {
  if (existsSync(SYSTEM_PROMPT_PATH)) {
    return readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
  }
  return buildSystemPrompt(resolvePersona());
}

// ── Reflector ──

const REFLECTOR_PROMPT = `You are an expert at analyzing failures in document Q&A systems.

Given a set of failed question-answer pairs, write a concise analysis of WHY they failed.
Focus on the root cause patterns, not individual cases.

Be specific. Examples of good root causes:
- "The system only found one document when the answer requires cross-referencing two"
- "The system returned the original value, not the amended value"
- "The system didn't perform the calculation, just returned a raw number"

Output: 3-5 bullet points, each a specific root cause pattern. Nothing else.`;

async function reflect(
  failures: Array<{ question: string; expectedAnswer: string; actualAnswer: string; reason: string }>,
): Promise<string> {
  const failureText = failures.map((f, i) =>
    `Failure ${i + 1}:
  Question: ${f.question}
  Expected: ${f.expectedAnswer}
  Got: ${truncate(f.actualAnswer, 300)}
  Grader reason: ${f.reason}`
  ).join("\n\n");

  const prompt = `Analyze these ${failures.length} failures:\n\n${failureText}\n\nRoot cause patterns:`;

  return await llmCall(REFLECTOR_PROMPT, prompt);
}

// ── Curator ──

const CURATOR_PROMPT = `You are an expert at improving system prompts for document Q&A systems.

Given:
- The current system prompt
- Root cause analysis of failures
- The worst-performing dimension

Propose a SHORT addition to the system prompt that addresses the root causes.
Rules:
- Output ONLY the text to ADD. Do not repeat the existing prompt.
- Keep it under 5 lines.
- Be specific and actionable (e.g., "When asked about totals, sum ALL line items from the table")
- Start with a section header like "## Cross-Document Queries" or "## Calculations"
- Do NOT rewrite the entire prompt. This is a delta — an addition.

Output the addition only. Nothing else.`;

async function curate(
  currentPrompt: string,
  reflections: string,
  worst: WorstDimension,
): Promise<string> {
  const prompt = `Current system prompt (${currentPrompt.length} chars):
${currentPrompt}

Root cause analysis:
${reflections}

Worst dimension: ${worst.value} (${worst.dimension}) at ${(worst.accuracy * 100).toFixed(0)}% accuracy

Propose a system prompt addition to fix this:`;

  return await llmCall(CURATOR_PROMPT, prompt);
}

// ── Tester ──

/**
 * Re-run a set of questions with a modified system prompt and grade results.
 */
async function testPairs(
  pairs: Array<{ id: string; question: string; expectedAnswer: string }>,
  systemPrompt: string,
): Promise<TestResult[]> {
  const corpus = new CorpusManager();
  const results: TestResult[] = [];

  for (const pair of pairs) {
    try {
      // Fresh session with the proposed prompt
      const answer = await queryWithPrompt(pair.question, corpus.dir, systemPrompt);
      const grade = await gradeAnswer(pair.question, pair.expectedAnswer, answer);

      results.push({
        id: pair.id,
        question: pair.question,
        expectedAnswer: pair.expectedAnswer,
        actualAnswer: answer.trim(),
        pass: grade.pass,
        reason: grade.reason,
      });
    } catch (err) {
      results.push({
        id: pair.id,
        question: pair.question,
        expectedAnswer: pair.expectedAnswer,
        actualAnswer: "",
        pass: false,
        reason: `Error: ${(err as Error).message}`,
      });
    }
  }

  return results;
}

/**
 * Query Pi with a custom system prompt (for A/B testing).
 */
async function queryWithPrompt(
  question: string,
  corpusDir: string,
  systemPrompt: string,
): Promise<string> {
  const authStorage = new AuthStorage();
  const modelRegistry = new ModelRegistry(authStorage);

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 2 },
  });

  const loader = new DefaultResourceLoader({
    cwd: corpusDir,
    settingsManager,
    systemPromptOverride: () => systemPrompt,
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  const sessionManager = SessionManager.create(corpusDir, SESSION_DIR);

  const { session } = await createAgentSession({
    cwd: corpusDir,
    tools: createReadOnlyTools(corpusDir),
    resourceLoader: loader,
    sessionManager,
    settingsManager,
    authStorage,
    modelRegistry,
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

  await session.prompt(question);
  unsubscribe();
  session.dispose();

  return response;
}

// ── LLM Helper ──

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

  const sessionManager = SessionManager.create(process.cwd(), SESSION_DIR);

  const { session } = await createAgentSession({
    cwd: process.cwd(),
    tools: [],
    resourceLoader: loader,
    sessionManager,
    settingsManager,
    authStorage,
    modelRegistry,
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

function truncate(s: string, max: number): string {
  const clean = s.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + "…";
}
