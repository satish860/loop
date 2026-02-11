import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { backupConfig, restoreConfig } from "./helpers.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const LOOP_DIR = join(HOME, ".loop");

function run(cmd: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`npx tsx src/index.ts ${cmd}`, {
      encoding: "utf-8",
      timeout: 120_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.status ?? 1,
    };
  }
}

/**
 * Story 3.6: Keep `loop query` for scripting
 *
 * One-shot query, no interactive prompt, no session persistence.
 * --json for piping. Exit code 0 on success, 1 on error.
 */
describe("Story 3.6: loop query for scripting", () => {
  let configBackup: string | null;

  beforeAll(() => {
    configBackup = backupConfig();
    rmSync(LOOP_DIR, { recursive: true, force: true });
    restoreConfig(configBackup);
    execSync("npx tsx src/index.ts ingest fixtures/", {
      encoding: "utf-8",
      timeout: 120_000,
    });
  }, 120_000);

  afterAll(() => {
    restoreConfig(configBackup);
  });

  it("outputs answer to stdout and exits", () => {
    const { stdout, exitCode } = run('query "What type of aircraft is MSN 4521?"');
    expect(stdout.toLowerCase()).toContain("b777");
    expect(exitCode).toBe(0);
  }, 120_000);

  it("--json outputs valid structured JSON", () => {
    const { stdout, exitCode } = run('query --json "What type of aircraft is MSN 4521?"');

    // stdout should be parseable JSON
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.query).toContain("MSN 4521");
    expect(parsed.answer.toLowerCase()).toContain("b777");
    expect(exitCode).toBe(0);
  }, 120_000);

  it("--json output works with pipe (no extra noise on stdout)", () => {
    const { stdout } = run('query --json "What is the lease term for MSN 4521?"');

    // Every line on stdout should be valid JSON (single line expected)
    const lines = stdout.trim().split("\n");
    expect(lines.length).toBe(1);
    expect(() => JSON.parse(lines[0])).not.toThrow();
  }, 120_000);

  it("exit code 1 on error (empty corpus)", () => {
    // Point to empty corpus by removing it temporarily
    const corpusDir = join(LOOP_DIR, "corpus");
    const backupDir = join(LOOP_DIR, "corpus_backup");

    // Rename corpus to simulate empty
    execSync(`mv "${corpusDir}" "${backupDir}"`, { encoding: "utf-8" });

    try {
      const { exitCode, stderr } = run('query "anything"');
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/no documents/i);
    } finally {
      // Restore
      execSync(`mv "${backupDir}" "${corpusDir}"`, { encoding: "utf-8" });
    }
  });

  it("--json suppresses progress noise from stdout", () => {
    const { stdout } = run('query --json "What type is MSN 4521?"');

    // stdout should ONLY be the JSON line — no progress, no ANSI codes
    const lines = stdout.trim().split("\n");
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  }, 120_000);

  it("--persona works with query", () => {
    const { stdout, exitCode } = run('query --json --persona finance "What is the engine reserve?"');
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.answer).toMatch(/350|420/);
    expect(exitCode).toBe(0);
  }, 120_000);
});
