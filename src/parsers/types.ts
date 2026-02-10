export interface ParseResult {
  source: string;       // original filename (e.g., "BESTBUY_2023_10K.pdf")
  outputPath: string;   // where parsed text was written
  format: "pdf" | "excel" | "csv";
  pages?: number;       // PDF page count
  sheets?: number;      // Excel sheet count
  rows?: number;        // CSV/Excel row count
}
