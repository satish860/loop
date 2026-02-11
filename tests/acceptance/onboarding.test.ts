import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  isFirstRun,
  checkProvider,
  runSilentOnboarding,
} from "../../src/core/onboarding.js";
import { loadConfig, saveConfig } from "../../src/core/config.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const LOOP_DIR = join(HOME, ".loop");
const CONFIG_PATH = join(LOOP_DIR, "config.json");

// We need to preserve and restore existing config so tests don't nuke real setup
let savedConfig: string | null = null;
let hadLoopDir = false;

/**
 * IMPORTANT: These tests manipulate ~/.loop/config.json.
 * We back up and restore the real config around tests.
 */
function backupConfig(): void {
  hadLoopDir = existsSync(LOOP_DIR);
  if (existsSync(CONFIG_PATH)) {
    savedConfig = readFileSync(CONFIG_PATH, "utf-8");
  } else {
    savedConfig = null;
  }
}

function restoreConfig(): void {
  if (savedConfig !== null) {
    mkdirSync(LOOP_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, savedConfig, "utf-8");
  } else if (existsSync(CONFIG_PATH)) {
    // Config didn't exist before test — remove the one we created
    rmSync(CONFIG_PATH, { force: true });
  }
}

function removeConfig(): void {
  if (existsSync(CONFIG_PATH)) {
    rmSync(CONFIG_PATH, { force: true });
  }
}

describe("onboarding", () => {
  beforeEach(() => {
    backupConfig();
  });

  afterEach(() => {
    restoreConfig();
  });

  // ── isFirstRun detection ──

  test("isFirstRun returns true when no config.json exists", () => {
    removeConfig();
    expect(isFirstRun()).toBe(true);
  });

  test("isFirstRun returns false when config.json exists", () => {
    saveConfig({ persona: "general" });
    expect(isFirstRun()).toBe(false);
  });

  // ── Provider check ──

  test("checkProvider detects available LLM providers", () => {
    const result = checkProvider();

    // In our dev environment we should have at least one provider (ANTHROPIC_API_KEY)
    // If this test runs in CI without keys, it's still valid — just checks the shape
    expect(result).toHaveProperty("found");
    expect(result).toHaveProperty("providers");
    expect(result).toHaveProperty("models");
    expect(result).toHaveProperty("message");
    expect(typeof result.found).toBe("boolean");
    expect(Array.isArray(result.providers)).toBe(true);
    expect(Array.isArray(result.models)).toBe(true);
    expect(typeof result.message).toBe("string");
  });

  test("checkProvider shows helpful message when providers exist", () => {
    const result = checkProvider();

    if (result.found) {
      // Should mention a real provider/model
      expect(result.providers.length).toBeGreaterThan(0);
      expect(result.models.length).toBeGreaterThan(0);
      expect(result.message).toContain("/"); // e.g. "anthropic/claude..."
    } else {
      // Should show setup instructions
      expect(result.message).toContain("ANTHROPIC_API_KEY");
    }
  });

  // ── Silent onboarding (non-interactive) ──

  test("silent onboarding creates config with defaults", () => {
    removeConfig();
    expect(isFirstRun()).toBe(true);

    const result = runSilentOnboarding();

    expect(result.completed).toBe(true);
    expect(result.persona).toBe("general");
    expect(result.skipped).toBe(true);
    expect(existsSync(CONFIG_PATH)).toBe(true);

    const config = loadConfig();
    expect(config.persona).toBe("general");
  });

  test("silent onboarding creates ~/.loop/ directory", () => {
    removeConfig();
    const result = runSilentOnboarding();
    expect(existsSync(LOOP_DIR)).toBe(true);
    expect(result.completed).toBe(true);
  });

  // ── Config persistence ──

  test("onboarding does not run again after config created", () => {
    removeConfig();
    expect(isFirstRun()).toBe(true);

    // First run
    runSilentOnboarding();
    expect(isFirstRun()).toBe(false);

    // Second run — should not need onboarding
    expect(isFirstRun()).toBe(false);
  });

  test("existing persona is preserved when not first run", () => {
    saveConfig({ persona: "finance" });
    expect(isFirstRun()).toBe(false);

    const config = loadConfig();
    expect(config.persona).toBe("finance");
  });

  // ── Provider message format ──

  test("no-provider message is helpful (no Pi leakage)", () => {
    const result = checkProvider();

    if (!result.found) {
      expect(result.message).toContain("No LLM provider configured");
      // Should NOT mention Pi — it's an implementation detail
      expect(result.message).not.toContain("pi ");
      expect(result.message).not.toContain("`pi`");
    }
    // If providers are found, that's fine too — this test adapts
    expect(result.message.length).toBeGreaterThan(0);
  });
});
