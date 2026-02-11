import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
const IS_CI = !!process.env.CI;
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CorpusManager } from "../../src/core/corpus.js";
import {
  generateQA,
  parseQAPairsFromText,
  calculateCoverage,
  QUESTION_TYPES,
  DIFFICULTIES,
  SOURCE_FORMATS,
  type QAPair,
} from "../../src/core/qa-generator.js";
import { parsePdf } from "../../src/parsers/pdf.js";
import { parseExcel } from "../../src/parsers/excel.js";
import { parseCsv } from "../../src/parsers/csv.js";
import { classifyDocument } from "../../src/core/classifier.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const TEST_CORPUS = join(tmpdir(), `loop-test-qa-${Date.now()}`);
const FIXTURES = join(process.cwd(), "fixtures");

describe("Story 4.2: Generate QA pairs with dimensions", () => {
  beforeAll(async () => {
    // Ingest all fixtures into a test corpus
    const corpus = new CorpusManager(TEST_CORPUS);

    const files = [
      { path: join(FIXTURES, "sample_lease.pdf"), parser: parsePdf },
      { path: join(FIXTURES, "sample_amendment.pdf"), parser: parsePdf },
      { path: join(FIXTURES, "fleet_sample.xlsx"), parser: parseExcel },
      { path: join(FIXTURES, "utilization_sample.csv"), parser: parseCsv },
    ];

    for (const f of files) {
      const tmpOut = join(tmpdir(), `loop-qa-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
      const result = await f.parser(f.path, tmpOut);
      const docType = await classifyDocument(result.outputPath);
      corpus.addDocument(result, docType);
    }
  }, 120_000);

  afterAll(() => {
    if (existsSync(TEST_CORPUS)) rmSync(TEST_CORPUS, { recursive: true });
    // Clean up benchmark drafts
    const benchDir = join(HOME, ".loop", "benchmarks", "custom");
    if (existsSync(join(benchDir, "qa-pairs-draft.jsonl"))) {
      rmSync(join(benchDir, "qa-pairs-draft.jsonl"));
    }
  });

  test.skipIf(IS_CI)("generates dimension-tagged QA pairs from corpus", async () => {
    const result = await generateQA({
      count: 10,
      corpusDir: TEST_CORPUS,
    });

    // Correct count
    expect(result.pairs.length).toBe(10);

    // Every pair has required fields
    for (const p of result.pairs) {
      expect(p.id).toBeDefined();
      expect(p.question).toBeTruthy();
      expect(p.expectedAnswer).toBeTruthy();
      expect(p.source).toBeTruthy();
      expect(p.dimensions).toBeDefined();
      expect(p.dimensions.questionType).toBeDefined();
      expect(p.dimensions.difficulty).toBeDefined();
      expect(p.dimensions.sourceFormat).toBeDefined();
      expect(p.status).toBe("keep");
    }

    // All dimension values are valid
    for (const p of result.pairs) {
      expect(QUESTION_TYPES).toContain(p.dimensions.questionType);
      expect(DIFFICULTIES).toContain(p.dimensions.difficulty);
      expect(SOURCE_FORMATS).toContain(p.dimensions.sourceFormat);
    }

    // Coverage: at least 2 question types represented
    const types = new Set(result.pairs.map((p) => p.dimensions.questionType));
    expect(types.size).toBeGreaterThanOrEqual(2);

    // Output file exists
    expect(existsSync(result.outputPath)).toBe(true);
  }, 180_000);

  test.skipIf(IS_CI)("includes cross-document questions", async () => {
    const result = await generateQA({
      count: 10,
      corpusDir: TEST_CORPUS,
    });

    const crossDoc = result.pairs.filter(
      (p) => p.dimensions.difficulty === "cross-document"
    );
    expect(crossDoc.length).toBeGreaterThanOrEqual(1);
  }, 180_000);

  test.skipIf(IS_CI)("includes not_answerable questions", async () => {
    const result = await generateQA({
      count: 10,
      corpusDir: TEST_CORPUS,
    });

    const negative = result.pairs.filter(
      (p) => p.dimensions.edgeCase === "not_answerable"
    );
    expect(negative.length).toBeGreaterThanOrEqual(1);

    // Not_answerable should have "NOT_ANSWERABLE" as expected answer
    for (const p of negative) {
      expect(p.expectedAnswer).toContain("NOT_ANSWERABLE");
    }
  }, 180_000);

  test.skipIf(IS_CI)("coverage summary is calculated correctly", async () => {
    const result = await generateQA({
      count: 10,
      corpusDir: TEST_CORPUS,
    });

    const cov = result.coverage;
    expect(Object.keys(cov.questionTypes).length).toBeGreaterThan(0);
    expect(Object.keys(cov.difficulties).length).toBeGreaterThan(0);
    expect(Object.keys(cov.sourceFormats).length).toBeGreaterThan(0);

    // Sum of question types = total pairs
    const typeSum = Object.values(cov.questionTypes).reduce((a, b) => a + b, 0);
    expect(typeSum).toBe(result.pairs.length);
  }, 180_000);

  test.skipIf(IS_CI)("saves to JSONL with one pair per line", async () => {
    const result = await generateQA({
      count: 5,
      corpusDir: TEST_CORPUS,
    });

    const content = readFileSync(result.outputPath, "utf-8").trim();
    const lines = content.split("\n");
    expect(lines.length).toBe(5);

    // Each line is valid JSON
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.question).toBeTruthy();
      expect(parsed.id).toBeTruthy();
    }
  }, 180_000);

  // ── Unit-level tests for parsing (no LLM) ──

  test("parseQAPairsFromText: extracts from raw JSON array", () => {
    const text = `[{"question":"Q1","expectedAnswer":"A1","source":"file.pdf","dimensions":{"questionType":"factual","difficulty":"surface","sourceFormat":"pdf"}}]`;
    const pairs = parseQAPairsFromText(text);
    expect(pairs.length).toBe(1);
    expect(pairs[0].question).toBe("Q1");
  });

  test("parseQAPairsFromText: extracts from code block", () => {
    const text = "Here are the pairs:\n```json\n[{\"question\":\"Q1\",\"expectedAnswer\":\"A1\",\"source\":\"f.pdf\",\"dimensions\":{\"questionType\":\"factual\",\"difficulty\":\"surface\",\"sourceFormat\":\"pdf\"}}]\n```\nDone.";
    const pairs = parseQAPairsFromText(text);
    expect(pairs.length).toBe(1);
    expect(pairs[0].question).toBe("Q1");
  });

  test("parseQAPairsFromText: handles mixed text with JSON", () => {
    const text = `I found the following questions:\n[{"question":"Test?","expectedAnswer":"Yes","source":"doc.pdf","dimensions":{"questionType":"factual","difficulty":"surface","sourceFormat":"pdf"}}]\nThese cover the corpus.`;
    const pairs = parseQAPairsFromText(text);
    expect(pairs.length).toBe(1);
  });

  test("parseQAPairsFromText: returns empty array for invalid text", () => {
    expect(parseQAPairsFromText("no json here")).toEqual([]);
    expect(parseQAPairsFromText("")).toEqual([]);
  });

  test("calculateCoverage: counts dimensions correctly", () => {
    const pairs: QAPair[] = [
      { id: "1", question: "Q", expectedAnswer: "A", source: "f", dimensions: { questionType: "factual", difficulty: "surface", sourceFormat: "pdf" }, status: "keep" },
      { id: "2", question: "Q", expectedAnswer: "A", source: "f", dimensions: { questionType: "factual", difficulty: "buried", sourceFormat: "excel" }, status: "keep" },
      { id: "3", question: "Q", expectedAnswer: "A", source: "f", dimensions: { questionType: "numerical", difficulty: "surface", sourceFormat: "pdf", edgeCase: "not_answerable" }, status: "keep" },
    ];
    const cov = calculateCoverage(pairs);
    expect(cov.questionTypes).toEqual({ factual: 2, numerical: 1 });
    expect(cov.difficulties).toEqual({ surface: 2, buried: 1 });
    expect(cov.sourceFormats).toEqual({ pdf: 2, excel: 1 });
    expect(cov.edgeCases).toEqual({ not_answerable: 1 });
  });
});
