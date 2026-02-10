import { existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { parsePdf } from "../parsers/pdf.js";
import { CorpusManager } from "../core/corpus.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SUPPORTED = new Set([".pdf"]);

export async function ingest(source: string): Promise<void> {
  const filepath = resolve(source);

  // Validate file exists
  if (!existsSync(filepath)) {
    console.error(`Error: File not found: ${filepath}`);
    process.exit(1);
  }

  // Validate format
  const ext = extname(filepath).toLowerCase();
  if (!SUPPORTED.has(ext)) {
    console.error(`Error: Unsupported format '${ext}'. Supported: ${[...SUPPORTED].join(", ")}`);
    process.exit(1);
  }

  const corpus = new CorpusManager();

  // Parse
  console.log(`Parsing: ${source}`);
  const tmpOut = join(tmpdir(), `loop-parse-${Date.now()}.txt`);

  const result = await parsePdf(filepath, tmpOut);
  console.log(`Pages: ${result.pages}`);

  // Store in corpus
  const meta = corpus.addDocument(result);
  const docs = corpus.listDocuments();

  console.log(`Stored: ${meta.filename} (${result.pages} pages). Corpus: ${docs.length} document${docs.length !== 1 ? "s" : ""}`);
}
