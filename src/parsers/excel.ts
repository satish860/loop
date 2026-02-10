import ExcelJS from "exceljs";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { ParseResult } from "./types.js";

export async function parseExcel(
  inputPath: string,
  outputPath: string
): Promise<ParseResult> {
  if (!existsSync(inputPath)) {
    throw new Error(`File not found: ${inputPath}`);
  }

  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.readFile(inputPath);
  } catch (err: any) {
    throw new Error(`Excel parsing failed: ${err.message}`);
  }

  const parts: string[] = [];
  let totalRows = 0;

  for (const sheet of workbook.worksheets) {
    parts.push(`--- SHEET "${sheet.name}" ---`);

    // Get headers from first row
    const headers: string[] = [];
    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      headers.push(String(cell.value ?? `Col${colNumber}`));
    });

    if (headers.length === 0) continue;

    parts.push(headers.join(" | "));

    // Data rows
    const dataRowCount = Math.max(0, sheet.rowCount - 1);
    totalRows += dataRowCount;

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const values: string[] = [];

      for (let c = 1; c <= headers.length; c++) {
        const cell = row.getCell(c);
        values.push(String(cell.value ?? ""));
      }

      // Skip completely empty rows
      if (values.every((v) => v === "" || v === "null")) continue;

      parts.push(values.join(" | "));
    }

    parts.push(""); // blank line between sheets
  }

  const text = parts.join("\n");
  await writeFile(outputPath, text, "utf-8");

  return {
    source: basename(inputPath),
    outputPath,
    format: "excel",
    sheets: workbook.worksheets.length,
    rows: totalRows,
  };
}
