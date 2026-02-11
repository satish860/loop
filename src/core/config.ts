import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const CONFIG_PATH = join(HOME, ".loop", "config.json");

export const VALID_PERSONAS = [
  "general",
  "portfolio_manager",
  "legal",
  "finance",
  "technical",
  "executive",
  "junior",
] as const;

export type Persona = (typeof VALID_PERSONAS)[number];

export interface LoopConfig {
  persona: Persona;
  model?: string;
  apiKey?: string;
}

const DEFAULT_CONFIG: LoopConfig = {
  persona: "general",
};

/**
 * Persona prompt additions — injected after the base system prompt.
 * `general` has no addition (default behavior).
 */
export const PERSONA_PROMPTS: Record<Persona, string> = {
  general: "",

  portfolio_manager: `
PERSONA: Portfolio Manager
- Focus on asset values, lease terms, return metrics, and portfolio-level summaries.
- Highlight financial exposure, concentration risk, and fleet composition.
- Compare across assets when data is available.
- Summarize in terms a portfolio manager would use: yield, residual value, utilization.`,

  legal: `
PERSONA: Legal Analyst
- Reference specific clauses, sections, and article numbers from the documents.
- Use precise contractual language (e.g., "pursuant to Section 4.2").
- Note defined terms and their definitions when relevant.
- Flag amendment supersession — cite which document takes precedence.
- Mention governing law, jurisdiction, and notice requirements when applicable.`,

  finance: `
PERSONA: Finance Analyst
- Show calculations step-by-step with breakdowns.
- Include per-unit costs (per flight hour, per cycle, per month).
- Present numerical data in structured format when possible.
- Note currency, rates, and time periods explicitly.
- Compare figures across documents (original vs amended values).`,

  technical: `
PERSONA: Technical Specialist
- Focus on aircraft specifications, MSN/ESN identifiers, engine types, and configurations.
- Reference maintenance intervals, reserve rates, and inspection schedules.
- Use precise technical terminology (C-check, D-check, FH, FC).
- Note component life limits and service bulletin compliance.`,

  executive: `
PERSONA: Executive Summary
- Be brief and high-level. Lead with the key takeaway.
- Focus on business impact, risk, and strategic implications.
- Use bullet points for key metrics.
- Skip granular details unless specifically asked.
- One paragraph max unless the question demands more.`,

  junior: `
PERSONA: Junior Analyst (Educational)
- Explain industry terms and jargon when they appear.
- Provide context for why numbers or clauses matter.
- Use clear, approachable language.
- When citing a clause, briefly explain what it means in practice.
- If a concept might be unfamiliar, add a brief explanation.`,
};

/** Read config from disk. Returns defaults if file doesn't exist. */
export function loadConfig(): LoopConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Write config to disk. Creates parent dirs if needed. */
export function saveConfig(config: LoopConfig): void {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/** Get the effective persona — CLI override > config file > "general" */
export function resolvePersona(cliOverride?: string): Persona {
  if (cliOverride) {
    if (!VALID_PERSONAS.includes(cliOverride as Persona)) {
      throw new Error(
        `Invalid persona: "${cliOverride}". Valid: ${VALID_PERSONAS.join(", ")}`
      );
    }
    return cliOverride as Persona;
  }
  return loadConfig().persona;
}

/** Pretty name for display */
export function personaDisplayName(persona: Persona): string {
  const names: Record<Persona, string> = {
    general: "General",
    portfolio_manager: "Portfolio Manager",
    legal: "Legal Analyst",
    finance: "Finance Analyst",
    technical: "Technical Specialist",
    executive: "Executive",
    junior: "Junior Analyst",
  };
  return names[persona];
}

export { CONFIG_PATH };
