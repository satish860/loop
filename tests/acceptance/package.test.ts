import { describe, test, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

describe("Story 6.4: npm package + install", () => {

  test("package.json has required fields", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
    expect(pkg.name).toBe("loop-ai");
    expect(pkg.version).toBe("0.1.0");
    expect(pkg.bin.loop).toBe("dist/index.js");
    expect(pkg.files).toBeDefined();
    expect(pkg.files).toContain("dist/");
    expect(pkg.files).toContain("python/");
    expect(pkg.engines.node).toBeDefined();
  });

  test("entry point has shebang", () => {
    const content = readFileSync("dist/index.js", "utf-8");
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  test("loop --version prints version", () => {
    const output = execSync("node dist/index.js --version", { encoding: "utf-8" }).trim();
    expect(output).toBe("0.1.0");
  });

  test("loop --help shows all commands", () => {
    const output = execSync("node dist/index.js --help", { encoding: "utf-8" });
    expect(output).toContain("ingest");
    expect(output).toContain("query");
    expect(output).toContain("chat");
    expect(output).toContain("generate-qa");
    expect(output).toContain("eval");
    expect(output).toContain("demo");
    expect(output).toContain("status");
    expect(output).toContain("config");
  });

  test("npm pack produces tarball under 10MB", () => {
    const output = execSync("npm pack --dry-run 2>&1", { encoding: "utf-8" });
    const sizeMatch = output.match(/package size:\s+([\d.]+)\s+(MB|kB)/);
    expect(sizeMatch).not.toBeNull();
    const size = parseFloat(sizeMatch![1]);
    const unit = sizeMatch![2];
    const sizeMB = unit === "kB" ? size / 1024 : size;
    expect(sizeMB).toBeLessThan(10);
  });

  test("tarball includes dist, python, fixtures, excludes src, tests", () => {
    const output = execSync("npm pack --dry-run 2>&1", { encoding: "utf-8" });
    expect(output).toContain("dist/index.js");
    expect(output).toContain("dist/commands/demo.js");
    expect(output).toContain("python/parse_pdf.py");
    expect(output).toContain("fixtures/AMD_2022_10K.pdf");
    expect(output).not.toContain("src/index.ts");
    expect(output).not.toContain("tests/");
    expect(output).not.toContain("node_modules/");
  });

  test("postinstall script runs without crashing", () => {
    const output = execSync("node dist/postinstall.js", { encoding: "utf-8" });
    expect(output).toContain("Loop installed successfully");
  });
});
