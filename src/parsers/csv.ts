import Papa from "papaparse";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { ParseResult } from "./types.js";

export async function parseCsv(
  inputPath: string,
  outputPath: string
): Promise<ParseResult> {
  if (!existsSync(inputPath)) {
    throw new Error(`File not found: ${inputPath}`);
  }

  const raw = await readFile(inputPath, "utf-8");
  const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });

  if (parsed.errors.length > 0) {
    const firstErr = parsed.errors[0];
    console.warn(`CSV parse warning (row ${firstErr.row}): ${firstErr.message}`);
  }

  const headers = parsed.meta.fields || [];
  const rows = parsed.data as Record<string, string>[];

  const parts: string[] = [];
  parts.push(headers.join(" | "));

  for (const row of rows) {
    const values = headers.map((h) => row[h] ?? "");
    parts.push(values.join(" | "));
  }

  const text = parts.join("\n");
  await writeFile(outputPath, text, "utf-8");

  return {
    source: basename(inputPath),
    outputPath,
    format: "csv",
    rows: rows.length,
  };
}
