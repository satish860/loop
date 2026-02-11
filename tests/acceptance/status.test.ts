import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import { rmSync, existsSync } from "fs";
import { join } from "path";
import { ChatSession } from "../../src/core/chat-session.js";
import { saveConfig } from "../../src/core/config.js";
import { backupConfig, restoreConfig } from "./helpers.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const LOOP_DIR = join(HOME, ".loop");

function cleanLoop() {
  const cfg = backupConfig();
  rmSync(LOOP_DIR, { recursive: true, force: true });
  restoreConfig(cfg);
}

function run(cmd: string): string {
  return execSync(`npx tsx src/index.ts ${cmd}`, {
    encoding: "utf-8",
    timeout: 30_000,
  });
}

/**
 * Story 3.5: loop status command
 *
 * Shows corpus stats, persona, chat session stats, and signal counts.
 */
describe("Story 3.5: loop status command", () => {
  describe("empty state", () => {
    it("shows empty corpus message when nothing ingested", () => {
      cleanLoop();
      const out = run("status");
      expect(out).toContain("No documents ingested");
    });
  });

  describe("with corpus and sessions", () => {
    beforeAll(() => {
      cleanLoop();
      execSync("npx tsx src/index.ts ingest fixtures/", {
        encoding: "utf-8",
        timeout: 120_000,
      });
    }, 120_000);

    it("shows document count by format", () => {
      const out = run("status");
      expect(out).toMatch(/\d+ document/);
      expect(out).toContain("PDF");
    });

    it("shows current persona", () => {
      saveConfig({ persona: "finance" });
      const out = run("status");
      expect(out).toContain("Finance Analyst");
      // Reset
      saveConfig({ persona: "general" });
    });

    it("shows 'No sessions yet' when no chat sessions exist", () => {
      const out = run("status");
      expect(out).toContain("No sessions");
    });

    it("shows session and signal counts after a chat", async () => {
      // Create a chat session with a correction → triggers signal
      const session = new ChatSession();
      await session.send("What is the engine reserve?");
      await session.send("That's wrong, it should be $420/FH");
      await session.end();

      const out = run("status");

      // Session count
      expect(out).toMatch(/1 session/);
      // Turn count
      expect(out).toMatch(/2 turn/);
      // Signals detected
      expect(out).toContain("correction");
    }, 120_000);

    it("works with empty corpus (shows help)", () => {
      // Point to a non-existent corpus
      cleanLoop();
      const out = run("status");
      expect(out).toContain("No documents ingested");
      expect(out).toMatch(/loop ingest/);
    });
  });
});
