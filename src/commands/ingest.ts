import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, extname, basename, join } from "node:path";
import { tmpdir } from "node:os";
import { parsePdf } from "../parsers/pdf.js";
import { parseExcel } from "../parsers/excel.js";
import { parseCsv } from "../parsers/csv.js";
import { CorpusManager } from "../core/corpus.js";
import type { ParseResult } from "../parsers/types.js";

const SUPPORTED = new Set([".pdf", ".xlsx", ".xls", ".csv"]);

/** Format a ParseResult into a human-readable summary string */
function formatResult(result: ParseResult): string {
  if (result.format === "pdf") return `${result.pages} page${result.pages !== 1 ? "s" : ""}`;
  if (result.format === "excel") return `${result.sheets} sheet${result.sheets !== 1 ? "s" : ""}, ${result.rows} rows`;
  if (result.format === "csv") return `${result.rows} row${result.rows !== 1 ? "s" : ""}`;
  return "";
}

/** Parse a single file using the correct parser based on extension */
async function parseFile(filepath: string): Promise<ParseResult> {
  const ext = extname(filepath).toLowerCase();
  const tmpOut = join(tmpdir(), `loop-parse-${Date.now()}.txt`);

  switch (ext) {
    case ".pdf":
      return parsePdf(filepath, tmpOut);
    case ".xlsx":
    case ".xls":
      return parseExcel(filepath, tmpOut);
    case ".csv":
      return parseCsv(filepath, tmpOut);
    default:
      throw new Error(`Unsupported format: ${ext}`);
  }
}

/** Recursively collect all files from a directory */
function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

export async function ingest(source: string): Promise<void> {
  const filepath = resolve(source);

  if (!existsSync(filepath)) {
    console.error(`Error: File not found: ${filepath}`);
    process.exit(1);
  }

  const corpus = new CorpusManager();
  const stat = statSync(filepath);

  // ─── Folder ingest ───
  if (stat.isDirectory()) {
    const allFiles = collectFiles(filepath);
    const supported = allFiles.filter((f) => SUPPORTED.has(extname(f).toLowerCase()));
    const skipped = allFiles.length - supported.length;

    if (supported.length === 0) {
      console.error(`No supported files found in ${source}. Supported: ${[...SUPPORTED].join(", ")}`);
      process.exit(1);
    }

    console.log(`Parsing: ${supported.length} files found`);

    let ingested = 0;
    let skippedExisting = 0;

    for (const file of supported) {
      const name = basename(file);

      if (corpus.isIngested(name)) {
        console.log(`  ⏭️  ${name} — already ingested, skipping`);
        skippedExisting++;
        continue;
      }

      try {
        const result = await parseFile(file);
        const ext = extname(file).toLowerCase();
        const typeLabel = ext === ".pdf" ? "PDF" : ext === ".csv" ? "CSV" : "Excel";
        corpus.addDocument(result);
        console.log(`  ✅ ${name.padEnd(30)} ${formatResult(result).padEnd(15)} ${typeLabel}`);
        ingested++;
      } catch (err: any) {
        console.error(`  ❌ ${name} — ${err.message}`);
      }
    }

    const docs = corpus.listDocuments();
    const parts: string[] = [`Corpus: ${docs.length} document${docs.length !== 1 ? "s" : ""}`];
    if (skippedExisting > 0) parts.push(`(${skippedExisting} already ingested)`);
    if (skipped > 0) parts.push(`(${skipped} unsupported skipped)`);
    console.log(parts.join(" "));
    return;
  }

  // ─── Single file ingest ───
  const ext = extname(filepath).toLowerCase();
  if (!SUPPORTED.has(ext)) {
    console.error(`Error: Unsupported format '${ext}'. Supported: ${[...SUPPORTED].join(", ")}`);
    process.exit(1);
  }

  const name = basename(filepath);
  if (corpus.isIngested(name)) {
    console.log(`Already ingested: ${name}, skipping`);
    return;
  }

  console.log(`Parsing: ${source}`);
  const result = await parseFile(filepath);
  console.log(formatResult(result));

  const meta = corpus.addDocument(result);
  const docs = corpus.listDocuments();
  console.log(`Stored: ${meta.filename} (${formatResult(result)}). Corpus: ${docs.length} document${docs.length !== 1 ? "s" : ""}`);
}
