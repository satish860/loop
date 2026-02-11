import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import Papa from "papaparse";
import type { QAPair } from "./qa-generator.js";
import { saveBenchmarkVersion } from "./benchmark-version.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const BENCHMARKS_DIR = join(HOME, ".loop", "benchmarks", "custom");

// ── CSV Column Mapping ──

const CSV_COLUMNS = [
  "id",
  "question",
  "expected_answer",
  "source",
  "page",
  "question_type",
  "difficulty",
  "source_format",
  "edge_case",
  "status",
];

interface CsvRow {
  id: string;
  question: string;
  expected_answer: string;
  source: string;
  page: string;
  question_type: string;
  difficulty: string;
  source_format: string;
  edge_case: string;
  status: string;
}

// ── Export ──

/** Convert QAPair[] to flat CSV rows */
function pairsToRows(pairs: QAPair[]): CsvRow[] {
  return pairs.map((p) => ({
    id: p.id,
    question: p.question,
    expected_answer: p.expectedAnswer,
    source: p.source,
    page: p.page ?? "",
    question_type: p.dimensions.questionType,
    difficulty: p.dimensions.difficulty,
    source_format: p.dimensions.sourceFormat,
    edge_case: p.dimensions.edgeCase ?? "",
    status: p.status,
  }));
}

/**
 * Export QA pairs to CSV for human review.
 *
 * Reads qa-pairs-draft.jsonl → writes qa-pairs-review.csv.
 * Returns the path to the CSV file.
 */
export function exportQAToCSV(outputPath?: string): string {
  const draftPath = join(BENCHMARKS_DIR, "qa-pairs-draft.jsonl");

  if (!existsSync(draftPath)) {
    throw new Error(
      "No draft QA pairs found. Run `loop generate-qa` first."
    );
  }

  const lines = readFileSync(draftPath, "utf-8").trim().split("\n");
  const pairs: QAPair[] = lines
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  if (pairs.length === 0) {
    throw new Error("Draft QA pairs file is empty.");
  }

  const rows = pairsToRows(pairs);
  const csv = Papa.unparse(rows, {
    columns: CSV_COLUMNS,
    quotes: true, // Always quote fields (safe for long text)
  });

  const dest = outputPath
    ? resolve(outputPath)
    : join(BENCHMARKS_DIR, "qa-pairs-review.csv");

  if (!existsSync(BENCHMARKS_DIR)) mkdirSync(BENCHMARKS_DIR, { recursive: true });
  writeFileSync(dest, csv, "utf-8");

  return dest;
}

// ── Import ──

export interface ImportResult {
  kept: number;
  discarded: number;
  edited: number;
  total: number;
  benchmarkPath: string;
  version: string;
}

/**
 * Import reviewed CSV and create the validated benchmark.
 *
 * Reads CSV → filters keep/edit → saves qa-pairs.jsonl.
 * Validates: no empty questions, no empty answers (except not_answerable).
 */
export function importQAFromCSV(csvPath: string): ImportResult {
  const fullPath = resolve(csvPath);

  if (!existsSync(fullPath)) {
    throw new Error(`CSV file not found: ${fullPath}`);
  }

  const raw = readFileSync(fullPath, "utf-8");
  const parsed = Papa.parse<CsvRow>(raw, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/ /g, "_"),
  });

  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(`CSV parse error at row ${first.row}: ${first.message}`);
  }

  const rows = parsed.data;
  if (rows.length === 0) {
    throw new Error("CSV file contains no data rows.");
  }

  // Validate and categorize
  let kept = 0;
  let discarded = 0;
  let edited = 0;
  const validPairs: QAPair[] = [];
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const status = (row.status ?? "keep").trim().toLowerCase();

    if (status === "discard") {
      discarded++;
      continue;
    }

    // Validate required fields
    const question = (row.question ?? "").trim();
    const answer = (row.expected_answer ?? "").trim();
    const source = (row.source ?? "").trim();
    const edgeCase = (row.edge_case ?? "").trim();

    if (!question) {
      errors.push(`Row ${i + 2}: empty question`);
      continue;
    }

    if (!answer && edgeCase !== "not_answerable") {
      errors.push(`Row ${i + 2}: empty expected_answer (not marked as not_answerable)`);
      continue;
    }

    if (!source) {
      errors.push(`Row ${i + 2}: empty source`);
      continue;
    }

    // Detect if row was edited (compare to draft)
    if (status === "edit") {
      edited++;
    } else {
      kept++;
    }

    validPairs.push({
      id: row.id || `qa-${String(validPairs.length + 1).padStart(3, "0")}`,
      question,
      expectedAnswer: answer || "NOT_ANSWERABLE",
      source,
      page: (row.page ?? "").trim() || undefined,
      dimensions: {
        questionType: (row.question_type ?? "factual").trim(),
        difficulty: (row.difficulty ?? "surface").trim(),
        sourceFormat: (row.source_format ?? "pdf").trim(),
        edgeCase: edgeCase || undefined,
      },
      status: "keep", // All imported pairs are "keep"
    });
  }

  if (errors.length > 0) {
    console.error(`Validation warnings:\n  ${errors.join("\n  ")}`);
  }

  // Re-assign sequential IDs
  validPairs.forEach((p, i) => {
    p.id = `qa-${String(i + 1).padStart(3, "0")}`;
  });

  // Save as versioned benchmark
  const versionMeta = saveBenchmarkVersion(validPairs);
  const benchmarkPath = join(BENCHMARKS_DIR, "qa-pairs.jsonl");

  return {
    kept,
    discarded,
    edited,
    total: validPairs.length,
    benchmarkPath,
    version: versionMeta.version,
  };
}

/** Load the validated benchmark (after human review) */
export function loadBenchmark(): QAPair[] | null {
  const path = join(BENCHMARKS_DIR, "qa-pairs.jsonl");
  if (!existsSync(path)) return null;

  const lines = readFileSync(path, "utf-8").trim().split("\n");
  return lines.filter((l) => l.trim()).map((l) => JSON.parse(l));
}
