import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { execSync } from "child_process";

describe("Story 1.1: Project scaffold", () => {
  it("has package.json with correct name", () => {
    expect(existsSync("package.json")).toBe(true);
    const pkg = JSON.parse(
      execSync("cat package.json", { encoding: "utf-8" })
    );
    expect(pkg.name).toBe("loop-ai");
    expect(pkg.version).toBe("0.1.0");
  });

  it("has tsconfig.json", () => {
    expect(existsSync("tsconfig.json")).toBe(true);
  });

  it("has src/index.ts entry point", () => {
    expect(existsSync("src/index.ts")).toBe(true);
  });

  it("has directory structure", () => {
    expect(existsSync("src/commands")).toBe(true);
    expect(existsSync("src/core")).toBe(true);
    expect(existsSync("src/parsers")).toBe(true);
    expect(existsSync("src/eval")).toBe(true);
    expect(existsSync("tests/acceptance")).toBe(true);
    expect(existsSync("fixtures")).toBe(true);
    expect(existsSync("python")).toBe(true);
  });

  it("has python requirements", () => {
    expect(existsSync("python/requirements.txt")).toBe(true);
    expect(existsSync("python/parse_pdf.py")).toBe(true);
  });

  it("has .gitignore", () => {
    expect(existsSync(".gitignore")).toBe(true);
  });

  it("CLI shows help with all 6 commands", () => {
    const help = execSync("npx tsx src/index.ts --help", {
      encoding: "utf-8",
    });
    expect(help).toContain("ingest");
    expect(help).toContain("query");
    expect(help).toContain("eval");
    expect(help).toContain("demo");
    expect(help).toContain("status");
    expect(help).toContain("config");
  });
});
