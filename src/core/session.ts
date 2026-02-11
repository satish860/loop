import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
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
import { PERSONA_PROMPTS, loadConfig, type Persona } from "./config.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const SESSION_DIR = join(HOME, ".loop", "sessions");

const BASE_SYSTEM_PROMPT = `You are a document intelligence assistant. You answer questions about ingested documents with precise citations.

HOW DOCUMENTS ARE STRUCTURED:
- Each document is a .txt file with page markers: --- PAGE 1 ---, --- PAGE 2 ---, etc.
- To find which page content is on, look for the nearest --- PAGE N --- marker ABOVE the matching text.
- When you grep and find a match, read the surrounding area to find the page marker.

RULES:
1. First, read INDEX.md to see what documents are available.
2. Use grep to search for keywords, then read the surrounding lines to find the --- PAGE N --- marker.
3. EVERY answer MUST end with a citation in this EXACT format: [filename.txt, Page N]
4. Include a verbatim quote from the source wrapped in quotation marks.
5. If the answer is not in the documents, say "I don't know — the documents don't contain this information."
6. Never hallucinate. Never guess. Only state what the documents say.
7. Be concise. Answer the question directly, then provide the citation.
8. For numerical answers, extract the exact number from the document.

CITATION FORMAT (mandatory, always at the end):
**Source: [ORIGINAL_FILENAME, Page N]**
Use the ORIGINAL filename from INDEX.md (e.g., BESTBUY_2023_10K.pdf), NOT the .txt filename.`;

const SYSTEM_PROMPT_PATH = join(HOME, ".loop", "system.md");

/** Build system prompt: custom file if exists, otherwise hardcoded default + persona */
export function buildSystemPrompt(persona?: Persona): string {
  // If user has a custom system prompt (from eval --improve --apply), use it
  const base = existsSync(SYSTEM_PROMPT_PATH)
    ? readFileSync(SYSTEM_PROMPT_PATH, "utf-8")
    : BASE_SYSTEM_PROMPT;

  if (!persona || persona === "general") return base;
  const addition = PERSONA_PROMPTS[persona];
  return addition ? `${base}\n${addition}` : base;
}

/** Get the hardcoded default system prompt (ignoring any custom file) */
export function getDefaultSystemPrompt(): string {
  return BASE_SYSTEM_PROMPT;
}

export interface SessionOptions {
  /** Start a fresh session instead of resuming */
  fresh?: boolean;
  /** Persona to inject into system prompt */
  persona?: Persona;
  /** Model override (e.g., "openrouter/moonshotai/kimi-k2.5") */
  model?: string;
}

export async function createLoopSession(
  corpusDir: string,
  opts?: SessionOptions
): Promise<AgentSession> {
  const authStorage = new AuthStorage();
  const modelRegistry = new ModelRegistry(authStorage);

  // Fail fast if no LLM provider is configured
  const available = modelRegistry.getAvailable();
  if (available.length === 0) {
    throw new Error(
      "No LLM provider configured.\n\n" +
      "Run `loop` to set up your API key, or set an environment variable:\n" +
      "  ANTHROPIC_API_KEY=sk-ant-...\n" +
      "  OPENAI_API_KEY=sk-...\n" +
      "  GEMINI_API_KEY=..."
    );
  }

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 2 },
  });

  const systemPrompt = buildSystemPrompt(opts?.persona);

  const loader = new DefaultResourceLoader({
    cwd: corpusDir,
    settingsManager,
    systemPromptOverride: () => systemPrompt,
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  // Fresh session or continue the most recent one
  const sessionManager = opts?.fresh
    ? SessionManager.create(corpusDir, SESSION_DIR)
    : SessionManager.continueRecent(corpusDir, SESSION_DIR);

  // Resolve configured model (e.g., "openrouter/moonshotai/kimi-k2.5")
  let model: any;
  const configuredModel = opts?.model ?? loadConfig().model;
  if (configuredModel) {
    const slashIdx = configuredModel.indexOf("/");
    if (slashIdx > 0) {
      const provider = configuredModel.substring(0, slashIdx);
      const modelId = configuredModel.substring(slashIdx + 1);
      model = modelRegistry.find(provider, modelId);
      if (!model) {
        throw new Error(
          `Model "${configuredModel}" not found.\n` +
          `Check that the provider API key is set (e.g., OPENROUTER_API_KEY) ` +
          `and the model ID is correct.`
        );
      }
    }
  }

  const { session } = await createAgentSession({
    cwd: corpusDir,
    tools: createReadOnlyTools(corpusDir),
    resourceLoader: loader,
    sessionManager,
    settingsManager,
    authStorage,
    modelRegistry,
    ...(model ? { model } : {}),
  });

  return session;
}
