import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { CorpusManager } from "../../src/core/corpus.js";
import { classifyDocument, DOC_TYPES, type DocType } from "../../src/core/classifier.js";
import { parsePdf } from "../../src/parsers/pdf.js";
import { parseExcel } from "../../src/parsers/excel.js";
import { parseCsv } from "../../src/parsers/csv.js";
import { tmpdir } from "node:os";

const TEST_CORPUS = join(tmpdir(), `loop-test-classify-${Date.now()}`);
const FIXTURES = join(process.cwd(), "fixtures");

describe("Story 4.1: Document type classification", () => {
  afterAll(() => {
    if (existsSync(TEST_CORPUS)) rmSync(TEST_CORPUS, { recursive: true });
  });

  test("classifies lease PDF as 'lease'", async () => {
    const tmpOut = join(tmpdir(), `loop-classify-lease-${Date.now()}.txt`);
    const result = await parsePdf(join(FIXTURES, "sample_lease.pdf"), tmpOut);
    const docType = await classifyDocument(result.outputPath);
    expect(docType).toBe("lease");
  }, 60_000);

  test("classifies amendment PDF as 'amendment'", async () => {
    const tmpOut = join(tmpdir(), `loop-classify-amend-${Date.now()}.txt`);
    const result = await parsePdf(join(FIXTURES, "sample_amendment.pdf"), tmpOut);
    const docType = await classifyDocument(result.outputPath);
    expect(docType).toBe("amendment");
  }, 60_000);

  test("classifies fleet Excel as 'fleet_data'", async () => {
    const tmpOut = join(tmpdir(), `loop-classify-fleet-${Date.now()}.txt`);
    const result = await parseExcel(join(FIXTURES, "fleet_sample.xlsx"), tmpOut);
    const docType = await classifyDocument(result.outputPath);
    expect(docType).toBe("fleet_data");
  }, 60_000);

  test("classifies utilization CSV as 'utilization_data'", async () => {
    const tmpOut = join(tmpdir(), `loop-classify-util-${Date.now()}.txt`);
    const result = await parseCsv(join(FIXTURES, "utilization_sample.csv"), tmpOut);
    const docType = await classifyDocument(result.outputPath);
    expect(docType).toBe("utilization_data");
  }, 60_000);

  test("classification stored in corpus metadata after ingest", async () => {
    const corpus = new CorpusManager(TEST_CORPUS);

    // Ingest lease PDF with classification
    const tmpOut = join(tmpdir(), `loop-classify-corpus-${Date.now()}.txt`);
    const result = await parsePdf(join(FIXTURES, "sample_lease.pdf"), tmpOut);
    const docType = await classifyDocument(result.outputPath);
    corpus.addDocument(result, docType);

    // Check metadata
    const docs = corpus.listDocuments();
    const lease = docs.find((d) => d.source === "sample_lease.pdf");
    expect(lease).toBeDefined();
    expect(lease!.docType).toBe("lease");
  }, 60_000);

  test("classification shown in INDEX.md", async () => {
    // INDEX.md should already exist from previous test
    const indexPath = join(TEST_CORPUS, "INDEX.md");
    expect(existsSync(indexPath)).toBe(true);

    const index = readFileSync(indexPath, "utf-8");
    expect(index).toContain("[lease]");
  });

  test("all returned types are valid DocType values", async () => {
    // Verify the classifier only returns valid types
    const tmpOut = join(tmpdir(), `loop-classify-valid-${Date.now()}.txt`);
    const result = await parsePdf(join(FIXTURES, "sample_lease.pdf"), tmpOut);
    const docType = await classifyDocument(result.outputPath);
    expect(DOC_TYPES).toContain(docType);
  }, 60_000);

  test("classification is best-effort — empty text returns 'other'", async () => {
    // Write an empty file
    const emptyPath = join(tmpdir(), `loop-classify-empty-${Date.now()}.txt`);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(emptyPath, "", "utf-8");
    const docType = await classifyDocument(emptyPath);
    expect(docType).toBe("other");
  });
});
