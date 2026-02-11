import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as readline from "node:readline";
import {
  AuthStorage,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import {
  loadConfig,
  saveConfig,
  VALID_PERSONAS,
  personaDisplayName,
  type Persona,
  type LoopConfig,
} from "./config.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const LOOP_DIR = join(HOME, ".loop");
const CONFIG_PATH = join(LOOP_DIR, "config.json");

// ANSI
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

// ── Detection ──────────────────────────────────────────────

/** Check if this is a first run (no config file yet) */
export function isFirstRun(): boolean {
  return !existsSync(CONFIG_PATH);
}

// ── Provider Check ─────────────────────────────────────────

export interface ProviderCheckResult {
  found: boolean;
  providers: string[];     // e.g. ["anthropic", "openai"]
  models: string[];        // e.g. ["anthropic/claude-sonnet-4-5"]
  message: string;         // Human-readable summary
}

/** Check what LLM providers are available */
export function checkProvider(): ProviderCheckResult {
  const authStorage = new AuthStorage();
  const modelRegistry = new ModelRegistry(authStorage);
  const available = modelRegistry.getAvailable();

  if (available.length === 0) {
    return {
      found: false,
      providers: [],
      models: [],
      message: "No LLM provider configured.",
    };
  }

  const providers = [...new Set(available.map((m) => m.provider))];
  const models = available.map((m) => `${m.provider}/${m.id}`);

  // Pick a representative model to show — prefer latest sonnet/gpt-4
  const preferred =
    available.find((m) => m.id.includes("sonnet-4-5")) ??
    available.find((m) => m.id.includes("sonnet-4")) ??
    available.find((m) => m.id.includes("gpt-4o")) ??
    available.find((m) => m.id.includes("sonnet")) ??
    available.find((m) => m.id.includes("gpt-4")) ??
    available[0];
  const modelStr = `${preferred.provider}/${preferred.id}`;

  return {
    found: true,
    providers,
    models,
    message: `Found: ${modelStr}${available.length > 1 ? ` (+${available.length - 1} more)` : ""}`,
  };
}

// ── Provider Setup ─────────────────────────────────────────

/** Detect provider from API key format */
function detectProvider(key: string): string | null {
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("sk-")) return "openai";
  return null;
}

/** Save an API key so Loop can use it */
function saveApiKey(provider: string, apiKey: string): void {
  const authStorage = new AuthStorage();
  authStorage.set(provider, { type: "api_key", key: apiKey });
}

/** Run OAuth login flow for a provider */
async function loginOAuth(providerId: string): Promise<boolean> {
  const authStorage = new AuthStorage();
  const oauthProviders = authStorage.getOAuthProviders();
  const provider = oauthProviders.find((p) => p.id === providerId);
  if (!provider) return false;

  try {
    await authStorage.login(providerId as any, {
      onAuth: ({ url }: { url: string }) => {
        console.log();
        console.log(`  ${BOLD}Open this URL in your browser:${RESET}`);
        console.log(`  ${CYAN}${url}${RESET}`);
        console.log();
      },
      onPrompt: (_: any) => {
        return promptInput(`  ${GREEN}Paste the authorization code:${RESET} `);
      },
    });
    return true;
  } catch (err: any) {
    console.log(`  ${RED}Login failed: ${err.message}${RESET}`);
    return false;
  }
}

/** Prompt user to set up LLM access — subscription or API key */
async function setupProvider(): Promise<boolean> {
  console.log(`  ${DIM}Loop needs access to an LLM to answer questions.${RESET}`);
  console.log();
  console.log(`    ${CYAN}1.${RESET} Claude subscription ${DIM}(Pro/Max — no API key needed)${RESET}`);
  console.log(`    ${CYAN}2.${RESET} API key ${DIM}(Anthropic, OpenAI, or Google)${RESET}`);
  console.log();

  const choice = await promptInput(`  ${GREEN}Choice [1]:${RESET} `);
  const num = parseInt(choice, 10);

  if (!choice || isNaN(num) || num === 1) {
    // OAuth login — Claude subscription
    console.log();
    console.log(`  ${DIM}Signing in with your Claude account...${RESET}`);
    const ok = await loginOAuth("anthropic");
    if (ok) {
      console.log(`  ${GREEN}✅${RESET} Claude subscription connected.`);
      return true;
    }
    return false;
  }

  if (num === 2) {
    // API key
    console.log();
    const key = await promptInput(`  ${GREEN}Paste your API key:${RESET} `);

    if (!key) {
      console.log(`  ${YELLOW}No key entered.${RESET}`);
      return false;
    }

    const provider = detectProvider(key);

    if (provider) {
      saveApiKey(provider, key);
      const label = provider === "anthropic" ? "Anthropic" : provider === "openai" ? "OpenAI" : provider;
      console.log(`  ${GREEN}✅${RESET} ${label} key saved.`);
      return true;
    }

    // Can't auto-detect — ask
    console.log();
    console.log(`    ${CYAN}1.${RESET} Anthropic (Claude)`);
    console.log(`    ${CYAN}2.${RESET} OpenAI (GPT)`);
    console.log(`    ${CYAN}3.${RESET} Google (Gemini)`);
    console.log();
    const provChoice = await promptInput(`  ${GREEN}Which provider? [1]:${RESET} `);
    const provNum = parseInt(provChoice, 10);

    const providers = ["anthropic", "openai", "google"];
    const labels = ["Anthropic", "OpenAI", "Google"];
    const idx = (!provChoice || isNaN(provNum)) ? 0 : Math.max(0, Math.min(provNum - 1, 2));

    saveApiKey(providers[idx], key);
    console.log(`  ${GREEN}✅${RESET} ${labels[idx]} key saved.`);
    return true;
  }

  return false;
}

// ── Persona Descriptions (short, for onboarding list) ──────

const PERSONA_SHORT: Record<Persona, string> = {
  general: "Default — balanced answers",
  portfolio_manager: "Asset values, lease terms, returns",
  finance: "Calculations, breakdowns, per-unit costs",
  legal: "Clause references, contractual language",
  technical: "Specs, MSN/ESN, maintenance schedules",
  executive: "Brief, high-level, key takeaways",
  junior: "Explanations, context, approachable",
};

// ── Interactive Onboarding ─────────────────────────────────

export interface OnboardingResult {
  completed: boolean;
  persona: Persona;
  providerFound: boolean;
  skipped?: boolean;
}

/**
 * Run the interactive first-run onboarding flow.
 * Shows welcome, checks/sets up provider, picks persona, saves config.
 */
export async function runOnboarding(): Promise<OnboardingResult> {
  // Banner
  console.log();
  console.log(`  ${BOLD}Welcome to Loop 🔄${RESET}`);
  console.log(`  ${DIM}AI that learns from every correction${RESET}`);
  console.log();
  console.log(`  ${DIM}Let's get you set up. This takes about 30 seconds.${RESET}`);
  console.log();

  // Step 1: Check LLM provider
  console.log(`  ${BOLD}Step 1: LLM Provider${RESET}`);
  let provider = checkProvider();

  if (provider.found) {
    console.log(`  ${GREEN}✅${RESET} ${provider.message}`);
  } else {
    // No provider — guide setup
    const saved = await setupProvider();

    if (saved) {
      // Re-check
      provider = checkProvider();
      if (!provider.found) {
        console.log(`  ${YELLOW}Key saved but no models found. Check the key and try again.${RESET}`);
        console.log();
        ensureLoopDir();
        saveConfig({ persona: "general" });
        return { completed: false, persona: "general", providerFound: false };
      }
      console.log(`  ${DIM}${provider.message}${RESET}`);
    } else {
      console.log();
      console.log(`  ${YELLOW}Loop needs an API key to work.${RESET}`);
      console.log(`  ${DIM}You can also set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY as an environment variable.${RESET}`);
      console.log();
      ensureLoopDir();
      saveConfig({ persona: "general" });
      return { completed: false, persona: "general", providerFound: false };
    }
  }
  console.log();

  // Step 2: Persona selection
  console.log(`  ${BOLD}Step 2: Choose a Persona${RESET}`);
  console.log(`  ${DIM}This adjusts how Loop answers. You can change it later with: loop config set persona <type>${RESET}`);
  console.log();

  const personas = VALID_PERSONAS.filter((p) => p !== "general");
  console.log(`    ${CYAN}1.${RESET} General ${DIM}— ${PERSONA_SHORT.general}${RESET}`);
  let i = 2;
  for (const p of personas) {
    console.log(`    ${CYAN}${i}.${RESET} ${personaDisplayName(p)} ${DIM}— ${PERSONA_SHORT[p]}${RESET}`);
    i++;
  }
  console.log();

  const choice = await promptInput(`  ${GREEN}Choice [1]:${RESET} `);
  const choiceNum = parseInt(choice, 10);

  let selectedPersona: Persona = "general";
  if (!choice || isNaN(choiceNum) || choiceNum === 1) {
    selectedPersona = "general";
  } else if (choiceNum >= 2 && choiceNum <= VALID_PERSONAS.length) {
    selectedPersona = personas[choiceNum - 2];
  }

  console.log(`  ${GREEN}✅${RESET} Persona set to: ${BOLD}${personaDisplayName(selectedPersona)}${RESET}`);
  console.log();

  // Save config
  ensureLoopDir();
  const config: LoopConfig = { persona: selectedPersona };
  saveConfig(config);

  // Step 3: Next steps
  console.log(`  ${BOLD}Step 3: Get Started${RESET}`);
  console.log();
  console.log(`    ${DIM}Ingest your documents:${RESET}`);
  console.log(`      loop ingest ./your-docs/       ${DIM}# folder of PDFs, Excel, CSV${RESET}`);
  console.log(`      loop ingest report.pdf          ${DIM}# single file${RESET}`);
  console.log();
  console.log(`    ${DIM}Or try the guided demo:${RESET}`);
  console.log(`      loop demo                       ${DIM}# walkthrough with sample docs${RESET}`);
  console.log();
  console.log(`  ${GREEN}Setup complete!${RESET} ${DIM}Config saved to ${CONFIG_PATH}${RESET}`);
  console.log();

  return { completed: true, persona: selectedPersona, providerFound: true };
}

/**
 * Non-interactive onboarding: just create defaults and return.
 * Used when stdin is not a TTY (pipes, CI, scripts).
 */
export function runSilentOnboarding(): OnboardingResult {
  ensureLoopDir();
  saveConfig({ persona: "general" });
  return { completed: true, persona: "general", providerFound: true, skipped: true };
}

// ── Helpers ────────────────────────────────────────────────

function ensureLoopDir(): void {
  if (!existsSync(LOOP_DIR)) {
    mkdirSync(LOOP_DIR, { recursive: true });
  }
}

function promptInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
