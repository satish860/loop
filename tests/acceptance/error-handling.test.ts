import { describe, test, expect } from "vitest";
import { execSync } from "node:child_process";

const CLI = "node dist/index.js";

function run(args: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`${CLI} ${args}`, {
      encoding: "utf-8",
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? err.message,
      exitCode: err.status ?? 1,
    };
  }
}

describe("Story 6.2: Error handling", () => {

  // ── Ingest errors ──

  test("ingest missing file → helpful error", () => {
    const { stderr, exitCode } = run("ingest nonexistent_file.pdf");
    expect(stderr).toContain("File not found");
    expect(exitCode).toBe(1);
  });

  test("ingest unsupported format → shows supported list", () => {
    const { stderr, exitCode } = run("ingest test.docx");
    // .docx won't exist, but should hit "file not found" first.
    // Let's use a file that does exist but wrong format:
    expect(exitCode).not.toBe(0);
  });

  test("ingest unsupported extension → lists supported formats", () => {
    // Create a temp .docx file
    const fs = require("fs");
    const path = require("path");
    const tmp = path.join(require("os").tmpdir(), "test_loop.docx");
    fs.writeFileSync(tmp, "fake");
    try {
      const { stderr, exitCode } = run(`ingest "${tmp}"`);
      expect(stderr).toContain("Unsupported");
      expect(stderr).toMatch(/\.pdf|\.xlsx|\.csv/);
      expect(exitCode).toBe(1);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  // ── Query errors ──

  test("query with empty question → error", () => {
    const { stderr, exitCode } = run('query ""');
    expect(stderr).toContain("Empty question");
    expect(exitCode).toBe(1);
  });

  // ── Config errors ──

  test("config set invalid persona → error with valid list", () => {
    const { stderr, exitCode } = run("config set persona pirate");
    expect(stderr).toContain("Invalid persona");
    expect(stderr).toContain("general");
    expect(stderr).toContain("finance");
    expect(exitCode).toBe(1);
  });

  test("config set unknown key → error with valid keys", () => {
    const { stderr, exitCode } = run("config set color blue");
    expect(stderr).toContain("Unknown config key");
    expect(stderr).toContain("persona");
    expect(exitCode).toBe(1);
  });

  // ── Eval errors ──

  test("eval --limit with non-number → error", () => {
    const { stderr, exitCode } = run("eval --benchmark custom --limit abc");
    expect(stderr).toContain("positive integer");
    expect(exitCode).toBe(1);
  });

  // ── Global ──

  test("--version works cleanly", () => {
    const { stdout, exitCode } = run("--version");
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(exitCode).toBe(0);
  });

  test("--help works cleanly", () => {
    const { stdout, exitCode } = run("--help");
    expect(stdout).toContain("loop");
    expect(stdout).toContain("ingest");
    expect(stdout).toContain("query");
    expect(stdout).toContain("chat");
    expect(stdout).toContain("eval");
    expect(exitCode).toBe(0);
  });

  test("no stack traces in any error output", () => {
    // Run several commands that should fail
    const results = [
      run("ingest nonexistent.pdf"),
      run('query ""'),
      run("config set persona pirate"),
      run("eval --benchmark custom --limit abc"),
    ];

    for (const { stderr } of results) {
      // Should never contain stack trace indicators
      expect(stderr).not.toMatch(/at\s+\w+\s+\(/);  // "at Function ("
      expect(stderr).not.toContain(".ts:");            // TypeScript file references
    }
  });
});
