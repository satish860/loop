import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Papa from "papaparse";
import { exportQAToCSV, importQAFromCSV, loadBenchmark } from "../../src/core/qa-review.js";
import type { QAPair } from "../../src/core/qa-generator.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const BENCHMARKS_DIR = join(HOME, ".loop", "benchmarks", "custom");
const TEST_DIR = join(tmpdir(), `loop-test-review-${Date.now()}`);

/** Create a minimal draft JSONL for testing (no LLM needed) */
function writeDraft(pairs: QAPair[]): void {
  if (!existsSync(BENCHMARKS_DIR)) mkdirSync(BENCHMARKS_DIR, { recursive: true });
  writeFileSync(
    join(BENCHMARKS_DIR, "qa-pairs-draft.jsonl"),
    pairs.map((p) => JSON.stringify(p)).join("\n") + "\n",
    "utf-8"
  );
}

function makePair(id: string, overrides?: Partial<QAPair>): QAPair {
  return {
    id,
    question: `Question for ${id}?`,
    expectedAnswer: `Answer for ${id}`,
    source: "test.pdf",
    page: "Page 1",
    dimensions: {
      questionType: "factual",
      difficulty: "surface",
      sourceFormat: "pdf",
    },
    status: "keep",
    ...overrides,
  };
}

describe("Story 4.3: Human review flow (CSV export/import)", () => {
  beforeEach(() => {
    // Clean benchmark files before each test
    for (const f of ["qa-pairs-draft.jsonl", "qa-pairs-review.csv", "qa-pairs.jsonl"]) {
      const p = join(BENCHMARKS_DIR, f);
      if (existsSync(p)) rmSync(p);
    }
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  test("export produces valid CSV with correct columns", () => {
    writeDraft([
      makePair("qa-001"),
      makePair("qa-002"),
      makePair("qa-003"),
    ]);

    const csvPath = exportQAToCSV();

    expect(existsSync(csvPath)).toBe(true);

    const csv = readFileSync(csvPath, "utf-8");
    const parsed = Papa.parse(csv, { header: true });

    expect(parsed.data.length).toBe(3);
    expect(parsed.meta.fields).toContain("id");
    expect(parsed.meta.fields).toContain("question");
    expect(parsed.meta.fields).toContain("expected_answer");
    expect(parsed.meta.fields).toContain("source");
    expect(parsed.meta.fields).toContain("status");
    expect(parsed.meta.fields).toContain("question_type");
    expect(parsed.meta.fields).toContain("difficulty");
    expect(parsed.meta.fields).toContain("source_format");
    expect(parsed.meta.fields).toContain("edge_case");
  });

  test("export handles long text with commas and quotes", () => {
    writeDraft([
      makePair("qa-001", {
        question: 'What is the "Base Rental" for Aircraft 2, per the lease?',
        expectedAnswer: "The Base Rental is $414,758.46, as stated in the amendment.",
      }),
    ]);

    const csvPath = exportQAToCSV();
    const csv = readFileSync(csvPath, "utf-8");
    const parsed = Papa.parse(csv, { header: true });
    const row = parsed.data[0] as any;

    expect(row.question).toContain('"Base Rental"');
    expect(row.expected_answer).toContain("$414,758.46");
  });

  test("export to custom path", () => {
    writeDraft([makePair("qa-001")]);
    const customPath = join(TEST_DIR, "my-review.csv");

    const csvPath = exportQAToCSV(customPath);

    expect(csvPath).toBe(customPath);
    expect(existsSync(customPath)).toBe(true);
  });

  test("export fails when no draft exists", () => {
    expect(() => exportQAToCSV()).toThrow("No draft QA pairs found");
  });

  test("import keeps all pairs when status is 'keep'", () => {
    writeDraft([
      makePair("qa-001"),
      makePair("qa-002"),
      makePair("qa-003"),
    ]);

    const csvPath = exportQAToCSV();
    const result = importQAFromCSV(csvPath);

    expect(result.total).toBe(3);
    expect(result.kept).toBe(3);
    expect(result.discarded).toBe(0);
    expect(result.edited).toBe(0);
    expect(existsSync(result.benchmarkPath)).toBe(true);
  });

  test("import filters out discarded pairs", () => {
    writeDraft([
      makePair("qa-001"),
      makePair("qa-002"),
      makePair("qa-003"),
      makePair("qa-004"),
      makePair("qa-005"),
    ]);

    const csvPath = exportQAToCSV();

    // Simulate human marking 2 pairs as discard
    let csv = readFileSync(csvPath, "utf-8");
    const lines = csv.split("\n");
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].includes("qa-002") || lines[i].includes("qa-004")) {
        lines[i] = lines[i].replace('"keep"', '"discard"');
      }
    }
    writeFileSync(csvPath, lines.join("\n"));

    const result = importQAFromCSV(csvPath);

    expect(result.total).toBe(3);
    expect(result.kept).toBe(3);
    expect(result.discarded).toBe(2);

    // Benchmark only has 3 pairs with re-numbered IDs
    const benchmark = loadBenchmark();
    expect(benchmark).not.toBeNull();
    expect(benchmark!.length).toBe(3);
    expect(benchmark![0].id).toBe("qa-001");
    expect(benchmark![1].id).toBe("qa-002");
    expect(benchmark![2].id).toBe("qa-003");
  });

  test("import detects edited pairs", () => {
    writeDraft([
      makePair("qa-001"),
      makePair("qa-002"),
    ]);

    const csvPath = exportQAToCSV();

    // Simulate human editing a pair and marking as 'edit'
    let csv = readFileSync(csvPath, "utf-8");
    csv = csv.replace('"Question for qa-001?"', '"Edited question?"');
    csv = csv.replace(/"qa-001"(.*)"keep"/, '"qa-001"$1"edit"');
    writeFileSync(csvPath, csv);

    const result = importQAFromCSV(csvPath);

    expect(result.total).toBe(2);
    expect(result.edited).toBe(1);
    expect(result.kept).toBe(1);

    const benchmark = loadBenchmark();
    expect(benchmark![0].question).toBe("Edited question?");
  });

  test("import validates: rejects empty questions", () => {
    const csvPath = join(TEST_DIR, "bad.csv");
    const csv = Papa.unparse([
      { id: "qa-001", question: "", expected_answer: "A", source: "f.pdf", page: "", question_type: "factual", difficulty: "surface", source_format: "pdf", edge_case: "", status: "keep" },
      { id: "qa-002", question: "Good Q?", expected_answer: "A", source: "f.pdf", page: "", question_type: "factual", difficulty: "surface", source_format: "pdf", edge_case: "", status: "keep" },
    ]);
    writeFileSync(csvPath, csv);

    const result = importQAFromCSV(csvPath);

    // Empty question is skipped, only 1 pair imported
    expect(result.total).toBe(1);
  });

  test("import allows empty answer for not_answerable", () => {
    const csvPath = join(TEST_DIR, "neg.csv");
    const csv = Papa.unparse([
      { id: "qa-001", question: "What is the revenue?", expected_answer: "", source: "f.pdf", page: "", question_type: "factual", difficulty: "surface", source_format: "pdf", edge_case: "not_answerable", status: "keep" },
    ]);
    writeFileSync(csvPath, csv);

    const result = importQAFromCSV(csvPath);

    expect(result.total).toBe(1);
    const benchmark = loadBenchmark();
    expect(benchmark![0].expectedAnswer).toBe("NOT_ANSWERABLE");
  });

  test("import fails on missing file", () => {
    expect(() => importQAFromCSV("nonexistent.csv")).toThrow("not found");
  });

  test("full roundtrip: generate → export → edit → import → benchmark", () => {
    // 10 pairs
    const pairs = Array.from({ length: 10 }, (_, i) =>
      makePair(`qa-${String(i + 1).padStart(3, "0")}`, {
        dimensions: {
          questionType: i < 5 ? "factual" : "numerical",
          difficulty: i < 3 ? "surface" : i < 7 ? "buried" : "cross-document",
          sourceFormat: "pdf",
          edgeCase: i === 9 ? "not_answerable" : undefined,
        },
      })
    );
    writeDraft(pairs);

    // Export
    const csvPath = exportQAToCSV();
    expect(existsSync(csvPath)).toBe(true);

    // Simulate human review: discard 3, edit 1
    let csv = readFileSync(csvPath, "utf-8");
    const lines = csv.split("\n");
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].includes("qa-002") || lines[i].includes("qa-005") || lines[i].includes("qa-008")) {
        lines[i] = lines[i].replace('"keep"', '"discard"');
      }
      if (lines[i].includes("qa-003")) {
        lines[i] = lines[i].replace('"keep"', '"edit"');
      }
    }
    writeFileSync(csvPath, lines.join("\n"));

    // Import
    const result = importQAFromCSV(csvPath);

    expect(result.total).toBe(7);
    expect(result.kept).toBe(6);
    expect(result.edited).toBe(1);
    expect(result.discarded).toBe(3);

    // Benchmark has 7 pairs with sequential IDs
    const benchmark = loadBenchmark();
    expect(benchmark!.length).toBe(7);
    expect(benchmark![0].id).toBe("qa-001");
    expect(benchmark![6].id).toBe("qa-007");
  });
});
