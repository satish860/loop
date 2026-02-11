import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
import { CorpusManager, type DocumentMeta } from "./corpus.js";
import type { DocType } from "./classifier.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const BENCHMARKS_DIR = join(HOME, ".loop", "benchmarks", "custom");
const SESSION_DIR = join(HOME, ".loop", "sessions", "qa-gen");

// ── Types ──

export const QUESTION_TYPES = [
  "factual",
  "numerical",
  "calculation",
  "comparison",
  "temporal",
  "conditional",
] as const;

export const DIFFICULTIES = [
  "surface",
  "buried",
  "cross-document",
  "implicit",
] as const;

export const SOURCE_FORMATS = ["pdf", "excel", "csv", "cross-format"] as const;

export const EDGE_CASES = [
  "not_answerable",
  "contradictory",
  "false_premise",
  "partial_info",
] as const;

export interface QAPairDimensions {
  questionType: string;
  difficulty: string;
  sourceFormat: string;
  edgeCase?: string;
}

export interface QAPair {
  id: string;
  question: string;
  expectedAnswer: string;
  source: string;
  page?: string;
  dimensions: QAPairDimensions;
  status: "keep" | "discard" | "edit";
}

export interface GenerateQAOptions {
  count?: number;
  corpusDir?: string;
  onProgress?: (message: string) => void;
}

export interface CoverageSummary {
  questionTypes: Record<string, number>;
  difficulties: Record<string, number>;
  sourceFormats: Record<string, number>;
  edgeCases: Record<string, number>;
}

export interface GenerateQAResult {
  pairs: QAPair[];
  outputPath: string;
  coverage: CoverageSummary;
}

// ── System Prompt ──

const QA_SYSTEM_PROMPT = `You are a benchmark QA pair generator for document intelligence testing.

Your job: read documents in the corpus, then generate question-answer pairs that test a system's ability to extract information accurately.

RULES:
1. Every expectedAnswer MUST be directly verifiable in the document text.
2. Include a brief verbatim quote from the source in each expectedAnswer.
3. Vary question types across: factual, numerical, calculation, comparison, temporal, conditional.
4. Vary difficulty: surface (obvious/first page), buried (deep in document), implicit (requires inference from multiple facts).
5. Cross-document questions should compare or combine facts from 2+ documents.
6. Not_answerable questions should be realistic but have NO answer in the corpus. Set expectedAnswer to "NOT_ANSWERABLE".
7. Be precise with page/sheet references.

OUTPUT FORMAT:
Return ONLY a valid JSON array. No markdown fences. No explanation before or after. Just the raw JSON array.

Each element:
{
  "question": "The question to ask",
  "expectedAnswer": "The correct answer with a supporting quote from the document",
  "source": "original_filename.pdf (use the ORIGINAL filename, not .txt)",
  "page": "Page 5 or Sheet: Fleet Overview",
  "dimensions": {
    "questionType": "factual|numerical|calculation|comparison|temporal|conditional",
    "difficulty": "surface|buried|cross-document|implicit",
    "sourceFormat": "pdf|excel|csv|cross-format"
  }
}

For not_answerable questions, add "edgeCase": "not_answerable" inside dimensions.
For cross-document questions, list all source filenames separated by " + " in the source field.`;

// ── Helpers ──

/** Send a prompt to a Pi session and capture the full text response */
async function promptAndCapture(
  session: AgentSession,
  message: string,
  onToolProgress?: (detail: string) => void
): Promise<string> {
  let response = "";

  const unsubscribe = session.subscribe((event) => {
    if (
      event.type === "message_update" &&
      (event as any).assistantMessageEvent?.type === "text_delta"
    ) {
      response += (event as any).assistantMessageEvent.delta;
    }

    if (event.type === "tool_execution_start" && onToolProgress) {
      const name = event.toolName;
      const input = event.args;
      const n = name.toLowerCase();
      if (n === "read" && input?.path) {
        onToolProgress(`Reading ${input.path}`);
      } else if (n === "grep" && input?.pattern) {
        onToolProgress(`Searching for "${input.pattern}"`);
      } else if (n === "bash" && input?.command) {
        onToolProgress(`Running: ${input.command}`);
      } else {
        onToolProgress(name);
      }
    }
  });

  await session.prompt(message);
  unsubscribe();
  return response;
}

/** Extract JSON array from LLM response text (handles code blocks, mixed text) */
export function parseQAPairsFromText(text: string): Partial<QAPair>[] {
  // Strategy 1: Try the whole response as JSON
  try {
    const parsed = JSON.parse(text.trim());
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  // Strategy 2: Find JSON array in ```json code block
  const codeBlockMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch {}
  }

  // Strategy 3: Find the largest JSON array in the text
  const arrayMatches = text.match(/\[[\s\S]*\]/g);
  if (arrayMatches) {
    // Try longest match first (most likely the full array)
    const sorted = arrayMatches.sort((a, b) => b.length - a.length);
    for (const match of sorted) {
      try {
        const parsed = JSON.parse(match);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {}
    }
  }

  // Strategy 4: Find individual JSON objects and collect them
  const objects: Partial<QAPair>[] = [];
  const objectRegex = /\{[^{}]*"question"[^{}]*\}/g;
  let match;
  while ((match = objectRegex.exec(text)) !== null) {
    try {
      objects.push(JSON.parse(match[0]));
    } catch {}
  }
  if (objects.length > 0) return objects;

  return [];
}

/** Validate and normalize a parsed QA pair */
function validatePair(raw: Partial<QAPair>, index: number): QAPair | null {
  if (!raw.question || !raw.expectedAnswer || !raw.source) return null;
  if (typeof raw.question !== "string" || typeof raw.expectedAnswer !== "string") return null;

  const dims = raw.dimensions ?? ({} as any);

  return {
    id: `qa-${String(index + 1).padStart(3, "0")}`,
    question: raw.question.trim(),
    expectedAnswer: raw.expectedAnswer.trim(),
    source: raw.source.trim(),
    page: raw.page?.toString().trim(),
    dimensions: {
      questionType: QUESTION_TYPES.includes(dims.questionType as any)
        ? dims.questionType
        : "factual",
      difficulty: DIFFICULTIES.includes(dims.difficulty as any)
        ? dims.difficulty
        : "surface",
      sourceFormat: SOURCE_FORMATS.includes(dims.sourceFormat as any)
        ? dims.sourceFormat
        : "pdf",
      edgeCase: EDGE_CASES.includes(dims.edgeCase as any)
        ? dims.edgeCase
        : undefined,
    },
    status: "keep",
  };
}

/** Calculate coverage statistics across dimensions */
export function calculateCoverage(pairs: QAPair[]): CoverageSummary {
  const questionTypes: Record<string, number> = {};
  const difficulties: Record<string, number> = {};
  const sourceFormats: Record<string, number> = {};
  const edgeCases: Record<string, number> = {};

  for (const p of pairs) {
    const d = p.dimensions;
    questionTypes[d.questionType] = (questionTypes[d.questionType] || 0) + 1;
    difficulties[d.difficulty] = (difficulties[d.difficulty] || 0) + 1;
    sourceFormats[d.sourceFormat] = (sourceFormats[d.sourceFormat] || 0) + 1;
    if (d.edgeCase) {
      edgeCases[d.edgeCase] = (edgeCases[d.edgeCase] || 0) + 1;
    }
  }

  return { questionTypes, difficulties, sourceFormats, edgeCases };
}

/** Build the generation plan based on corpus documents */
function buildGenerationPrompt(docs: DocumentMeta[], count: number): string {
  const crossCount = Math.max(1, Math.ceil(count * 0.15));
  const negCount = Math.max(1, Math.ceil(count * 0.15));
  const docPairsTotal = count - crossCount - negCount;

  // Weight by document size
  const sizes = docs.map((d) => {
    const raw = d.pages ?? d.rows ?? d.sheets ?? 1;
    return Math.max(1, Math.min(raw, 100)); // cap at 100 to avoid one doc dominating
  });
  const totalSize = sizes.reduce((a, b) => a + b, 0);

  const plan = docs
    .map((d, i) => {
      const share = Math.max(1, Math.round((docPairsTotal * sizes[i]) / totalSize));
      const typeTag = d.docType ? ` [${d.docType}]` : "";
      const sizeDesc =
        d.format === "pdf"
          ? `${d.pages} pages`
          : d.format === "excel"
            ? `${d.sheets} sheets, ${d.rows} rows`
            : `${d.rows} rows`;
      return `- ${d.source}${typeTag} (${sizeDesc}) → generate ${share} QA pairs`;
    })
    .join("\n");

  return `Read INDEX.md to understand the corpus, then explore the documents using the read tool.

Generate exactly ${count} QA pairs total. Here is your plan:

PER-DOCUMENT PAIRS (${docPairsTotal} total):
${plan}

CROSS-DOCUMENT PAIRS (${crossCount} total):
- Questions that require information from 2+ documents to answer
- Set difficulty to "cross-document" and sourceFormat to "cross-format" if applicable
- List both source filenames in the source field

NOT ANSWERABLE PAIRS (${negCount} total):
- Realistic questions a user might ask, but the answer is NOT in any document
- Set expectedAnswer to "NOT_ANSWERABLE" and add "edgeCase": "not_answerable"

IMPORTANT:
- Read at least the first 2-3 pages of each document to find real content for questions
- For large documents, also sample content from the middle and end
- Use ORIGINAL filenames (e.g., "01. Operating Lease (Aircraft 2) (9 September 2024).pdf"), not .txt names
- Include a mix of question types: factual, numerical, temporal, conditional, comparison
- Output ONLY the JSON array. No markdown, no explanation.`;
}

// ── Main ──

/** Create a Pi session configured for QA generation */
async function createQASession(corpusDir: string): Promise<AgentSession> {
  const authStorage = new AuthStorage();
  const modelRegistry = new ModelRegistry(authStorage);

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 2 },
  });

  const loader = new DefaultResourceLoader({
    cwd: corpusDir,
    settingsManager,
    systemPromptOverride: () => QA_SYSTEM_PROMPT,
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

  return session;
}

/**
 * Generate QA pairs from the corpus using Pi.
 *
 * Pi reads the corpus documents using its tools, then generates
 * dimension-tagged QA pairs as a JSON array.
 */
export async function generateQA(opts?: GenerateQAOptions): Promise<GenerateQAResult> {
  const count = opts?.count ?? 50;
  const progress = opts?.onProgress ?? (() => {});

  const corpus = new CorpusManager(opts?.corpusDir);
  const docs = corpus.listDocuments();

  if (docs.length === 0) {
    throw new Error("No documents in corpus. Run `loop ingest` first.");
  }

  progress(`Corpus: ${docs.length} documents`);
  progress(`Generating ${count} QA pairs...`);

  // Create Pi session with read-only tools
  const session = await createQASession(corpus.dir);

  // Build and send the generation prompt
  const prompt = buildGenerationPrompt(docs, count);
  const response = await promptAndCapture(session, prompt, progress);

  // Parse QA pairs from response
  let rawPairs = parseQAPairsFromText(response);
  progress(`Parsed ${rawPairs.length} pairs from response`);

  // Check for missing required dimensions and fill gaps
  const hasCrossDoc = rawPairs.some(
    (p) => p.dimensions?.difficulty === "cross-document"
  );
  const hasNotAnswerable = rawPairs.some(
    (p) => p.dimensions?.edgeCase === "not_answerable"
  );

  if (!hasCrossDoc && docs.length >= 2) {
    progress("Adding cross-document questions...");
    const crossPrompt = `Generate 2 cross-document QA pairs. Each question must require information from 2 or more documents to answer. Set difficulty to "cross-document". List all source filenames separated by " + " in the source field. Output ONLY the JSON array.`;
    const crossResponse = await promptAndCapture(session, crossPrompt, progress);
    rawPairs.push(...parseQAPairsFromText(crossResponse));
  }

  if (!hasNotAnswerable) {
    progress("Adding not-answerable questions...");
    const negPrompt = `Generate 2 not_answerable QA pairs. These should be realistic questions a user might ask about aircraft leasing, but the answer is NOT in any of the corpus documents. Set expectedAnswer to "NOT_ANSWERABLE" and add "edgeCase": "not_answerable" in dimensions. Output ONLY the JSON array.`;
    const negResponse = await promptAndCapture(session, negPrompt, progress);
    rawPairs.push(...parseQAPairsFromText(negResponse));
  }

  // If we still don't have enough, ask for more
  if (rawPairs.length < count) {
    const deficit = count - rawPairs.length;
    progress(`Need ${deficit} more pairs, requesting...`);

    const followUp = `I need ${deficit} more QA pairs to reach ${count} total. Generate ${deficit} additional pairs. Focus on documents and question types not yet covered. Output ONLY the JSON array.`;
    const moreResponse = await promptAndCapture(session, followUp, progress);
    rawPairs.push(...parseQAPairsFromText(moreResponse));
    progress(`Now have ${rawPairs.length} pairs total`);
  }

  session.dispose();

  // Validate all raw pairs first
  const allValid: QAPair[] = [];
  for (let i = 0; i < rawPairs.length; i++) {
    const valid = validatePair(rawPairs[i], i);
    if (valid) allValid.push(valid);
  }

  // Prioritize: ensure cross-doc and edge case pairs are included
  const prioritized: QAPair[] = [];
  const crossDocPairs = allValid.filter((p) => p.dimensions.difficulty === "cross-document");
  const edgeCasePairs = allValid.filter((p) => p.dimensions.edgeCase);
  const regularPairs = allValid.filter(
    (p) => p.dimensions.difficulty !== "cross-document" && !p.dimensions.edgeCase
  );

  // Add cross-doc first, then edge cases, then regular — up to count
  prioritized.push(...crossDocPairs);
  prioritized.push(...edgeCasePairs);
  prioritized.push(...regularPairs);

  // Trim and re-assign sequential IDs
  const validPairs = prioritized.slice(0, count).map((p, i) => ({
    ...p,
    id: `qa-${String(i + 1).padStart(3, "0")}`,
  }));

  // Save to JSONL
  if (!existsSync(BENCHMARKS_DIR)) mkdirSync(BENCHMARKS_DIR, { recursive: true });
  const outputPath = join(BENCHMARKS_DIR, "qa-pairs-draft.jsonl");
  writeFileSync(
    outputPath,
    validPairs.map((p) => JSON.stringify(p)).join("\n") + "\n",
    "utf-8"
  );

  const coverage = calculateCoverage(validPairs);

  return { pairs: validPairs, outputPath, coverage };
}

/** Load previously generated draft QA pairs */
export function loadDraftPairs(): QAPair[] {
  const draftPath = join(BENCHMARKS_DIR, "qa-pairs-draft.jsonl");
  if (!existsSync(draftPath)) return [];

  const { readFileSync } = require("node:fs");
  const lines = readFileSync(draftPath, "utf-8").trim().split("\n");
  return lines.filter((l: string) => l.trim()).map((l: string) => JSON.parse(l));
}
