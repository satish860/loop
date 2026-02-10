import { existsSync, mkdirSync, readdirSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import type { ParseResult } from "../parsers/types.js";

export interface DocumentMeta {
  filename: string;   // e.g., "BESTBUY_2023_10K.txt"
  source: string;     // e.g., "BESTBUY_2023_10K.pdf"
  format: string;     // "pdf" | "excel" | "csv"
  summary: string;    // first meaningful lines of content
  pages?: number;
  sheets?: number;
  rows?: number;
}

export class CorpusManager {
  readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? join(process.env.HOME ?? process.env.USERPROFILE ?? "~", ".loop", "corpus");
  }

  /** Ensure corpus directory exists */
  private ensureDir(): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  /** Add a parsed document to the corpus */
  addDocument(result: ParseResult): DocumentMeta {
    this.ensureDir();

    // Target filename: swap extension to .txt
    const txtName = basename(result.source, "." + result.source.split(".").pop()) + ".txt";
    const destPath = join(this.dir, txtName);

    copyFileSync(result.outputPath, destPath);

    const summary = this.extractSummary(destPath, result.format);

    const meta: DocumentMeta = {
      filename: txtName,
      source: result.source,
      format: result.format,
      summary,
      pages: result.pages,
      sheets: result.sheets,
      rows: result.rows,
    };

    // Store source mapping and metadata
    this.saveSourceMap(txtName, result.source);
    this.saveMetaMap(txtName, result);
    this.updateIndex();
    return meta;
  }

  /** Extract a one-line summary from the first page of parsed text */
  private extractSummary(filePath: string, format: string): string {
    const text = readFileSync(filePath, "utf-8");

    // Get content from first page/sheet (skip the marker line)
    const lines = text.split("\n")
      .filter((l) => !l.startsWith("---"))     // skip markers
      .map((l) => l.replace(/[_\s]+/g, " ").trim())  // clean whitespace
      .filter((l) => l.length > 10);            // skip short/empty lines

    // Take first 5 meaningful lines, join them
    const snippet = lines.slice(0, 5).join(" | ");

    // Truncate to 200 chars
    return snippet.length > 200 ? snippet.slice(0, 197) + "..." : snippet;
  }

  /** Check if a source file has already been ingested */
  isIngested(sourceFilename: string): boolean {
    const txtName = basename(sourceFilename, "." + sourceFilename.split(".").pop()) + ".txt";
    return existsSync(join(this.dir, txtName));
  }

  /** List all documents in the corpus */
  listDocuments(): DocumentMeta[] {
    if (!existsSync(this.dir)) return [];

    const sourceMap = this.loadSourceMap();
    const metaMap = this.loadMetaMap();

    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".txt"))
      .map((f) => {
        const original = sourceMap[f] || f;
        const meta = metaMap[f] || {};
        const ext = original.split(".").pop()?.toLowerCase() || "";
        const format = ext === "pdf" ? "pdf"
          : (ext === "xlsx" || ext === "xls") ? "excel"
          : ext === "csv" ? "csv" : "pdf";
        const summary = this.extractSummary(join(this.dir, f), format);
        return {
          filename: f,
          source: original,
          format: format as "pdf" | "excel" | "csv",
          summary,
          pages: meta.pages,
          sheets: meta.sheets,
          rows: meta.rows,
        };
      });
  }

  /** Load source map: txt filename → original filename */
  private loadSourceMap(): Record<string, string> {
    const mapPath = join(this.dir, "sources.json");
    if (existsSync(mapPath)) {
      return JSON.parse(readFileSync(mapPath, "utf-8"));
    }
    return {};
  }

  /** Save source mapping */
  private saveSourceMap(txtName: string, source: string): void {
    const map = this.loadSourceMap();
    map[txtName] = source;
    writeFileSync(join(this.dir, "sources.json"), JSON.stringify(map, null, 2), "utf-8");
  }

  /** Load metadata map: txt filename → {pages, sheets, rows} */
  private loadMetaMap(): Record<string, { pages?: number; sheets?: number; rows?: number }> {
    const mapPath = join(this.dir, "meta.json");
    if (existsSync(mapPath)) {
      return JSON.parse(readFileSync(mapPath, "utf-8"));
    }
    return {};
  }

  /** Save metadata for a document */
  private saveMetaMap(txtName: string, result: ParseResult): void {
    const map = this.loadMetaMap();
    map[txtName] = { pages: result.pages, sheets: result.sheets, rows: result.rows };
    writeFileSync(join(this.dir, "meta.json"), JSON.stringify(map, null, 2), "utf-8");
  }

  /** Regenerate INDEX.md — Pi reads this first to decide which documents to open */
  private updateIndex(): void {
    const files = readdirSync(this.dir).filter((f) => f.endsWith(".txt"));
    const count = files.length;
    const sourceMap = this.loadSourceMap();
    const metaMap = this.loadMetaMap();

    const entries = files.map((f) => {
      const original = sourceMap[f] || f;
      const meta = metaMap[f] || {};
      const ext = original.split(".").pop()?.toLowerCase() || "";

      let sizeInfo = "";
      if (ext === "pdf" && meta.pages) sizeInfo = `PDF, ${meta.pages} pages`;
      else if ((ext === "xlsx" || ext === "xls") && meta.sheets) sizeInfo = `Excel, ${meta.sheets} sheets, ${meta.rows ?? "?"} rows`;
      else if (ext === "csv" && meta.rows) sizeInfo = `CSV, ${meta.rows} rows`;

      const summary = this.extractSummary(join(this.dir, f), ext === "csv" ? "csv" : ext === "pdf" ? "pdf" : "excel");
      return `- ${f} (${sizeInfo}, original: ${original}): ${summary}`;
    });

    const lines = [
      `# Corpus — ${count} document${count !== 1 ? "s" : ""}`,
      "",
      "When citing, use the ORIGINAL filename (e.g., BESTBUY_2023_10K.pdf), not the .txt name.",
      "",
      ...entries,
      "",
    ];

    writeFileSync(join(this.dir, "INDEX.md"), lines.join("\n"), "utf-8");
  }
}
