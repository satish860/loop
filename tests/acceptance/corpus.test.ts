import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync, rmSync, mkdirSync } from "fs";
import { parsePdf } from "../../src/parsers/pdf.js";
import { CorpusManager } from "../../src/core/corpus.js";

const TEST_CORPUS = "fixtures/test-corpus";
const PDF = "fixtures/BESTBUY_2023_10K.pdf";
const PARSED_TMP = "fixtures/test-corpus-tmp/parsed.txt";

describe("Story 1.4 + 1.5: Corpus manager + INDEX.md", () => {
  let corpus: CorpusManager;

  beforeAll(() => {
    rmSync(TEST_CORPUS, { recursive: true, force: true });
    mkdirSync("fixtures/test-corpus-tmp", { recursive: true });
    corpus = new CorpusManager(TEST_CORPUS);
  });

  afterAll(() => {
    rmSync(TEST_CORPUS, { recursive: true, force: true });
    rmSync("fixtures/test-corpus-tmp", { recursive: true, force: true });
  });

  it("addDocument copies parsed text to corpus", async () => {
    const result = await parsePdf(PDF, PARSED_TMP);
    const meta = corpus.addDocument(result);

    expect(meta.filename).toBe("BESTBUY_2023_10K.txt");
    expect(meta.source).toBe("BESTBUY_2023_10K.pdf");
    expect(meta.format).toBe("pdf");
    expect(meta.pages).toBe(75);

    // File actually exists in corpus
    expect(existsSync(`${TEST_CORPUS}/BESTBUY_2023_10K.txt`)).toBe(true);
  });

  it("isIngested returns true for ingested file", () => {
    expect(corpus.isIngested("BESTBUY_2023_10K.pdf")).toBe(true);
    expect(corpus.isIngested("NONEXISTENT.pdf")).toBe(false);
  });

  it("listDocuments returns all ingested docs", () => {
    const docs = corpus.listDocuments();
    expect(docs.length).toBe(1);
    expect(docs[0].filename).toBe("BESTBUY_2023_10K.txt");
  });

  it("INDEX.md is generated with document list", () => {
    const indexPath = `${TEST_CORPUS}/INDEX.md`;
    expect(existsSync(indexPath)).toBe(true);

    const index = readFileSync(indexPath, "utf-8");
    expect(index).toContain("1 document");
    expect(index).toContain("BESTBUY_2023_10K.txt");
  });

  it("INDEX.md updates when new document added", async () => {
    // Simulate a second document by re-parsing to a different name
    const result = await parsePdf(PDF, PARSED_TMP);
    // Fake a different source name
    result.source = "FAKE_SECOND_DOC.pdf";
    corpus.addDocument(result);

    const index = readFileSync(`${TEST_CORPUS}/INDEX.md`, "utf-8");
    expect(index).toContain("2 documents");
    expect(index).toContain("BESTBUY_2023_10K.txt");
    expect(index).toContain("FAKE_SECOND_DOC.txt");
  });

  it("corpus directory created automatically", () => {
    rmSync(TEST_CORPUS, { recursive: true, force: true });
    const fresh = new CorpusManager(TEST_CORPUS);
    const result2 = {
      source: "test.pdf",
      outputPath: PARSED_TMP,
      format: "pdf" as const,
      pages: 1,
    };
    // Need the tmp file to exist
    mkdirSync("fixtures/test-corpus-tmp", { recursive: true });
    const parsed = parsePdf(PDF, PARSED_TMP);
    return parsed.then((r) => {
      fresh.addDocument(r);
      expect(existsSync(TEST_CORPUS)).toBe(true);
    });
  });
});
