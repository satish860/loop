import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  AuthStorage,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";

export const DOC_TYPES = [
  "lease",
  "amendment",
  "purchase",
  "insurance",
  "maintenance",
  "fleet_data",
  "utilization_data",
  "other",
] as const;

export type DocType = (typeof DOC_TYPES)[number];

const CLASSIFICATION_PROMPT = `You are a document classifier for aviation leasing documents.
Given the text snippet below, respond with EXACTLY ONE of these document types:
  lease, amendment, purchase, insurance, maintenance, fleet_data, utilization_data, other

Rules:
- lease: Aircraft operating/finance lease agreements
- amendment: Changes to existing agreements (amendments, supplements, side letters)
- purchase: Purchase agreements, letters of intent, bills of sale
- insurance: Insurance certificates, policies, coverage documents
- maintenance: Maintenance reserve agreements, C-check/D-check schedules, technical records
- fleet_data: Fleet lists, aircraft registries, portfolio spreadsheets with multiple aircraft
- utilization_data: Flight hours, cycles, utilization reports, storage status
- other: Anything that doesn't fit the above

Respond with ONLY the type. One word. Nothing else.`;

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const SESSION_DIR = join(HOME, ".loop", "sessions", "classifier");

/**
 * Classify a parsed document by reading its first ~2000 chars
 * and asking Pi to categorize it.
 *
 * Best-effort: returns "other" on any failure.
 */
export async function classifyDocument(parsedTextPath: string): Promise<DocType> {
  try {
    const text = readFileSync(parsedTextPath, "utf-8");
    const snippet = text.slice(0, 2000);

    if (snippet.trim().length < 20) {
      return "other";
    }

    const authStorage = new AuthStorage();
    const modelRegistry = new ModelRegistry(authStorage);

    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: true, maxRetries: 1 },
    });

    const loader = new DefaultResourceLoader({
      cwd: process.cwd(),
      settingsManager,
      systemPromptOverride: () => CLASSIFICATION_PROMPT,
      appendSystemPromptOverride: () => [],
    });
    await loader.reload();

    const sessionManager = SessionManager.create(process.cwd(), SESSION_DIR);

    const { session } = await createAgentSession({
      cwd: process.cwd(),
      tools: [], // No tools needed — just classification
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

    await session.prompt(`Classify this document:\n\n${snippet}`);
    unsubscribe();
    session.dispose();

    const cleaned = response.trim().toLowerCase().replace(/[^a-z_]/g, "");
    if (DOC_TYPES.includes(cleaned as DocType)) {
      return cleaned as DocType;
    }

    // Try to find a valid type within the response
    for (const t of DOC_TYPES) {
      if (response.toLowerCase().includes(t)) {
        return t;
      }
    }

    return "other";
  } catch (err) {
    // Best-effort: classification failure is not fatal
    return "other";
  }
}

/** Display-friendly name for a DocType */
export function docTypeDisplayName(docType: DocType): string {
  const names: Record<DocType, string> = {
    lease: "Lease Agreement",
    amendment: "Amendment",
    purchase: "Purchase Agreement",
    insurance: "Insurance",
    maintenance: "Maintenance",
    fleet_data: "Fleet Data",
    utilization_data: "Utilization Data",
    other: "Other",
  };
  return names[docType];
}
