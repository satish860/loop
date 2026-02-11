import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { ParseResult } from "./types.js";

const execFileAsync = promisify(execFile);

const PYTHON_SCRIPT = resolve(
  import.meta.dirname,
  "../../python/parse_pdf.py"
);

export async function parsePdf(
  inputPath: string,
  outputPath: string
): Promise<ParseResult> {
  if (!existsSync(inputPath)) {
    throw new Error(`File not found: ${inputPath}`);
  }

  try {
    await execFileAsync("python", [
      PYTHON_SCRIPT,
      inputPath,
      "--output",
      outputPath,
    ]);
  } catch (err: any) {
    const msg = err.stderr?.toString() || err.message;
    const code = err.code;

    // Python not installed
    if (code === "ENOENT" || msg.includes("ENOENT")) {
      throw new Error(
        "Python is required for PDF parsing but was not found.\n" +
        "Install Python 3.10+ from https://python.org\n" +
        "Then run: pip install pymupdf4llm"
      );
    }
    if (msg.includes("No module named")) {
      throw new Error(
        "pymupdf4llm is not installed. Run: pip install pymupdf4llm"
      );
    }
    if (msg.includes("no such file")) {
      throw new Error(`PDF file not found: ${inputPath}`);
    }
    throw new Error(`PDF parsing failed: ${msg}`);
  }

  // Count pages from the output
  const text = await readFile(outputPath, "utf-8");
  const pages = (text.match(/--- PAGE \d+ ---/g) || []).length;

  return {
    source: basename(inputPath),
    outputPath,
    format: "pdf",
    pages,
  };
}
