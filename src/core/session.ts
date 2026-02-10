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

const SYSTEM_PROMPT = `You are a document intelligence assistant. You answer questions about ingested documents with precise citations.

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

export async function createLoopSession(
  corpusDir: string
): Promise<AgentSession> {
  const authStorage = new AuthStorage();
  const modelRegistry = new ModelRegistry(authStorage);

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 2 },
  });

  const loader = new DefaultResourceLoader({
    cwd: corpusDir,
    settingsManager,
    systemPromptOverride: () => SYSTEM_PROMPT,
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: corpusDir,
    tools: createReadOnlyTools(corpusDir),
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
    authStorage,
    modelRegistry,
  });

  return session;
}
