import {
  loadConfig,
  saveConfig,
  VALID_PERSONAS,
  personaDisplayName,
  CONFIG_PATH,
  type Persona,
} from "../core/config.js";
import { CorpusManager } from "../core/corpus.js";
import { existsSync } from "node:fs";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export async function configShow(): Promise<void> {
  const cfg = loadConfig();

  console.log(`${BOLD}Loop Configuration${RESET}`);
  console.log(`${DIM}${CONFIG_PATH}${RESET}\n`);

  console.log(`  Persona: ${personaDisplayName(cfg.persona)} (${cfg.persona})`);
  if (cfg.model) {
    console.log(`  Model:   ${cfg.model}`);
  }

  // Corpus info
  const corpus = new CorpusManager();
  if (existsSync(corpus.dir)) {
    const docs = corpus.listDocuments();
    console.log(`  Corpus:  ${corpus.dir} (${docs.length} document${docs.length !== 1 ? "s" : ""})`);
  } else {
    console.log(`  Corpus:  (empty)`);
  }
}

export async function configSet(key: string, value: string): Promise<void> {
  const cfg = loadConfig();

  switch (key) {
    case "persona": {
      if (!VALID_PERSONAS.includes(value as Persona)) {
        console.error(
          `Invalid persona: "${value}"\nValid personas: ${VALID_PERSONAS.join(", ")}`
        );
        process.exit(1);
      }
      cfg.persona = value as Persona;
      saveConfig(cfg);
      console.log(`Persona set to: ${personaDisplayName(cfg.persona)} (${cfg.persona})`);
      break;
    }
    case "model": {
      cfg.model = value;
      saveConfig(cfg);
      console.log(`Model set to: ${value}`);
      break;
    }
    case "api-key": {
      cfg.apiKey = value;
      saveConfig(cfg);
      console.log(`API key saved.`);
      break;
    }
    default:
      console.error(`Unknown config key: "${key}"\nValid keys: persona, model, api-key`);
      process.exit(1);
  }
}
