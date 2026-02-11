import { describe, test, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { CorpusManager } from "../../src/core/corpus.js";

const CLI = "node dist/index.js";
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const DEMO_CORPUS = join(HOME, ".loop", "demo-corpus");

describe("Story 6.3: loop demo", () => {

  test("--quick downloads and ingests 10 SEC filings", () => {
    const output = execSync(`${CLI} demo --quick`, {
      encoding: "utf-8",
      timeout: 600_000,
    });

    expect(output).toContain("Loop Demo");
    expect(output).toContain("10 real SEC filings");
    expect(output).toMatch(/Corpus ready: 10 documents/);
    expect(output).toMatch(/1,792 pages/);
    expect(output).toContain("loop ingest");
    expect(output).toContain("loop chat");
    expect(output).toContain("loop eval");
  }, 600_000);

  test("demo corpus contains 10 documents", () => {
    const corpus = new CorpusManager(DEMO_CORPUS);
    const docs = corpus.listDocuments();
    expect(docs.length).toBe(10);
    expect(docs.find((d: any) => d.source === "AMD_2022_10K.pdf")).toBeDefined();
    expect(docs.find((d: any) => d.source === "BOEING_2022_10K.pdf")).toBeDefined();
    expect(docs.find((d: any) => d.source === "MICROSOFT_2023_10K.pdf")).toBeDefined();
  });

  test("interactive mode shows menu and runs a suggested query", () => {
    // Pipe "1" then "quit" to simulate user picking option 1
    const output = execSync(`echo 1\nquit | ${CLI} demo`, {
      encoding: "utf-8",
      timeout: 300_000,
      shell: "cmd.exe",
    });

    // Menu shown
    expect(output).toContain("Extract facts from a single filing");
    expect(output).toContain("Pull exact financial numbers");
    expect(output).toContain("Compare across companies");
    expect(output).toContain("Thematic analysis across sectors");
    expect(output).toContain("Find something that isn't there");

    // Teaching context shown
    expect(output).toContain("Loop will search a 121-page filing");

    // Query ran and got an answer
    expect(output).toContain("AMD");
    expect(output).toMatch(/Data Center|Client|Gaming|Embedded/i);

    // Takeaway shown
    expect(output).toContain("analyst");

    // Citation present
    expect(output).toContain("AMD_2022_10K.pdf");
  }, 300_000);

  test("interactive mode accepts free-form questions", () => {
    const output = execSync(
      `echo What is Microsoft's total revenue?\nquit | ${CLI} demo`,
      {
        encoding: "utf-8",
        timeout: 300_000,
        shell: "cmd.exe",
      }
    );

    expect(output).toContain("Microsoft");
    expect(output).toContain("MICROSOFT_2023_10K.pdf");
  }, 300_000);
});
