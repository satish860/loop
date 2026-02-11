#!/usr/bin/env node

/**
 * Postinstall — checks optional dependencies and prints helpful warnings.
 * Never fails (exit 0 always) — Python is optional unless you need PDF parsing.
 */

import { execSync } from "node:child_process";

const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

function check(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

console.log();
console.log(`  ${GREEN}✅ Loop installed successfully${RESET}`);
console.log();

// Check Python
const pythonVersion = check("python --version") ?? check("python3 --version");
if (pythonVersion) {
  // Check pymupdf4llm
  const hasPymupdf = check("python -c \"import pymupdf4llm\"") !== null
    || check("python3 -c \"import pymupdf4llm\"") !== null;

  if (hasPymupdf) {
    console.log(`  ${DIM}${pythonVersion} + pymupdf4llm — PDF parsing ready${RESET}`);
  } else {
    console.log(`  ${YELLOW}⚠  ${pythonVersion} found, but pymupdf4llm is missing.${RESET}`);
    console.log(`  ${DIM}  PDF parsing requires it. Install with:${RESET}`);
    console.log(`  ${DIM}  pip install pymupdf4llm${RESET}`);
    console.log();
    console.log(`  ${DIM}  Excel and CSV work without Python.${RESET}`);
  }
} else {
  console.log(`  ${YELLOW}⚠  Python not found. PDF parsing won't work.${RESET}`);
  console.log(`  ${DIM}  Install Python 3.10+ and pymupdf4llm:${RESET}`);
  console.log(`  ${DIM}  pip install pymupdf4llm${RESET}`);
  console.log();
  console.log(`  ${DIM}  Excel and CSV work without Python.${RESET}`);
}

console.log();
console.log(`  ${DIM}Get started:  loop demo${RESET}`);
console.log(`  ${DIM}Help:         loop --help${RESET}`);
console.log();

process.exit(0);
