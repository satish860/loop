import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { ChatSession } from "../../src/core/chat-session.js";
import {
  loadConfig,
  saveConfig,
  resolvePersona,
  VALID_PERSONAS,
  CONFIG_PATH,
} from "../../src/core/config.js";
import { backupConfig, restoreConfig } from "./helpers.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const LOOP_DIR = join(HOME, ".loop");

function ingestFixtures() {
  execSync("npx tsx src/index.ts ingest fixtures/", {
    encoding: "utf-8",
    timeout: 120_000,
  });
}

function runCLI(args: string): string {
  return execSync(`npx tsx src/index.ts ${args}`, {
    encoding: "utf-8",
    timeout: 30_000,
  });
}

/**
 * Story 3.4: Persona support
 *
 * `loop config set persona <type>` sets the answer style.
 * Persona modifies system prompt. Default is "general".
 */
describe("Story 3.4: Persona support", () => {
  beforeAll(() => {
    const cfg = backupConfig();
    rmSync(LOOP_DIR, { recursive: true, force: true });
    restoreConfig(cfg);
    ingestFixtures();
  }, 120_000);

  afterEach(() => {
    // Reset persona but preserve model config
    if (existsSync(CONFIG_PATH)) {
      const current = loadConfig();
      saveConfig({ ...current, persona: "general" });
    }
  });

  // ── Config management (no LLM) ──

  describe("config management", () => {
    it("defaults to 'general' persona when no config exists", () => {
      if (existsSync(CONFIG_PATH)) rmSync(CONFIG_PATH);
      const cfg = loadConfig();
      expect(cfg.persona).toBe("general");
    });

    it("persists persona to config.json", () => {
      saveConfig({ persona: "finance" });
      const cfg = loadConfig();
      expect(cfg.persona).toBe("finance");

      // File actually exists with correct content
      const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      expect(raw.persona).toBe("finance");
    });

    it("resolvePersona: CLI override takes precedence", () => {
      saveConfig({ persona: "finance" });
      expect(resolvePersona("legal")).toBe("legal");
    });

    it("resolvePersona: falls back to config", () => {
      saveConfig({ persona: "technical" });
      expect(resolvePersona()).toBe("technical");
    });

    it("resolvePersona: rejects invalid persona", () => {
      expect(() => resolvePersona("pirate")).toThrow(/invalid persona/i);
    });

    it("all 7 personas are valid", () => {
      expect(VALID_PERSONAS).toContain("general");
      expect(VALID_PERSONAS).toContain("portfolio_manager");
      expect(VALID_PERSONAS).toContain("legal");
      expect(VALID_PERSONAS).toContain("finance");
      expect(VALID_PERSONAS).toContain("technical");
      expect(VALID_PERSONAS).toContain("executive");
      expect(VALID_PERSONAS).toContain("junior");
      expect(VALID_PERSONAS.length).toBe(7);
    });

    it("CLI: loop config set persona finance", () => {
      const output = runCLI("config set persona finance");
      expect(output).toContain("Finance Analyst");
      const cfg = loadConfig();
      expect(cfg.persona).toBe("finance");
    });

    it("CLI: loop config show", () => {
      saveConfig({ persona: "legal" });
      const output = runCLI("config show");
      expect(output).toContain("Legal Analyst");
      expect(output).toContain("legal");
    });

    it("CLI: loop config set persona invalid → error", () => {
      try {
        runCLI("config set persona pirate");
        expect.unreachable("should have thrown");
      } catch (err: any) {
        expect(err.stderr || err.message).toMatch(/invalid persona|pirate/i);
      }
    });
  });

  // ── ChatSession respects persona ──

  describe("ChatSession persona", () => {
    it("uses config persona when no override given", () => {
      saveConfig({ persona: "executive" });
      const session = new ChatSession();
      expect(session.persona).toBe("executive");
      // Don't send — just verify persona resolved
    });

    it("CLI override beats config", () => {
      saveConfig({ persona: "finance" });
      const session = new ChatSession(undefined, { persona: "legal" });
      expect(session.persona).toBe("legal");
    });
  });

  // ── Real LLM: persona changes answer style ──

  describe("persona changes answer style", () => {
    it("finance persona includes numerical/calculation language", async () => {
      const session = new ChatSession(undefined, { persona: "finance" });
      const r = await session.send("What is the engine reserve for MSN 4521?");
      await session.end();

      // Should mention a dollar amount ($350 from fleet/lease or $420 from amendment)
      expect(r.answer).toMatch(/350|420/);
      // Finance persona should have calculation/rate language
      expect(r.answer.toLowerCase()).toMatch(
        /per flight hour|\/fh|rate|cost|usd|\$/i
      );
    }, 120_000);

    it("legal persona includes clause/section references", async () => {
      const session = new ChatSession(undefined, { persona: "legal" });
      const r = await session.send("What is the engine reserve for MSN 4521?");
      await session.end();

      // Should mention a dollar amount ($350 from fleet/lease or $420 from amendment)
      expect(r.answer).toMatch(/350|420/);
      // Legal persona should reference sections, clauses, or amendment language
      expect(r.answer.toLowerCase()).toMatch(
        /section|clause|amendment|pursuant|article|schedule/i
      );
    }, 120_000);

    it("executive persona gives a brief answer", async () => {
      const session = new ChatSession(undefined, { persona: "executive" });
      const r = await session.send("What is the engine reserve for MSN 4521?");
      await session.end();

      // Should mention a dollar amount ($350 from fleet or $420 from amendment)
      expect(r.answer).toMatch(/350|420/);
      // Executive answers should be concise
      expect(r.answer.length).toBeLessThan(2000);
    }, 120_000);
  });
});
