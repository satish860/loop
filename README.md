# Loop

**AI that learns from every correction** — document intelligence CLI powered by [Pi coding agent](https://github.com/nicholasgasior/pi-coding-agent).

Ingest PDFs, Excel, and CSV files. Ask questions. Get cited answers with page numbers. Loop improves accuracy through an eval loop — every correction makes the next answer better.

## Demo

```bash
# Ingest a folder of mixed documents
$ loop ingest ./portfolio/
Parsing: 5 files found
  ✅ BESTBUY_2023_10K.pdf         75 pages        PDF
  ✅ sample_lease.pdf              4 pages         PDF
  ✅ sample_amendment.pdf          2 pages         PDF
  ✅ fleet_sample.xlsx             3 sheets        Excel
  ✅ utilization_sample.csv       10 rows          CSV
Corpus: 5 documents

# Ask a question — watch Loop think
$ loop query "What aircraft type is MSN 4521?"
Searching 5 documents...

  ▸ Reading INDEX.md
  ▸ Searching for "MSN 4521" in fleet_sample.txt

MSN 4521 is a **Boeing B777-300ER**, leased to Emirates.

**Source: [fleet_sample.xlsx, Sheet "Fleet Overview"]**

# Cross-format conflict detection
$ loop query "What is the engine reserve rate for MSN 4521? Compare the fleet spreadsheet and amendments."
Searching 5 documents...

  ▸ Searching for "engine.*reserve" in fleet_sample.txt
  ▸ Searching for "engine.*reserve" in sample_amendment.txt

The engine maintenance reserve rate for MSN 4521 shows a **conflict**:

- **Fleet spreadsheet**: $350/FH (fleet_sample.xlsx, Sheet "Maintenance Reserves")
- **Amendment No. 1**: $420/FH effective October 1, 2024 (sample_amendment.pdf)

The amendment **supersedes** the original rate.
```

## How It Works

Loop embeds the Pi coding agent SDK — an LLM with `read`, `grep`, `find`, and `ls` tools. No embeddings. No vector database. No chunking pipeline.

1. **Ingest** — PDFs, Excel, and CSV files are parsed into plain text with page/sheet markers
2. **Query** — Pi reads the corpus index, greps for keywords, reads relevant sections, and answers with citations
3. **Eval** *(coming soon)* — Track accuracy over time. Every correction feeds back into the system prompt

The LLM decides how to explore documents. It decomposes questions, searches iteratively, and cites sources — the same way a human analyst would.

## Install

```bash
# Prerequisites
node >= 18
python >= 3.10  # only needed for PDF parsing

# Clone and install
git clone https://github.com/anthropics/loop.git
cd loop
npm install
pip install pymupdf4llm

# Build and link
npm run build
npm link

# Set up Pi (need an API key for Anthropic, OpenAI, or other provider)
# Pi uses ~/.pi/agent/auth.json for credentials
```

## Usage

```bash
# Ingest documents (PDF, Excel, CSV, or a folder)
loop ingest report.pdf
loop ingest fleet.xlsx
loop ingest data.csv
loop ingest ./portfolio/          # all supported files recursively

# Re-running ingest skips already-ingested files
loop ingest ./portfolio/          # "already ingested, skipping"

# Ask questions
loop query "What is the lease term for MSN 4521?"
loop query "Which aircraft had zero flight hours?"
loop query "Compare maintenance reserves across all documents"

# Check corpus status
loop status
```

## Supported Formats

| Format | Extension | Parser | Output |
|--------|-----------|--------|--------|
| PDF | `.pdf` | PyMuPDF4LLM (Python) | `--- PAGE N ---` markers |
| Excel | `.xlsx`, `.xls` | exceljs (Node.js) | `--- SHEET "name" ---` markers, pipe-delimited |
| CSV | `.csv` | papaparse (Node.js) | Pipe-delimited rows |

## Architecture

```
loop ingest <file|folder>
  │
  ├── Route by extension (.pdf → Python, .xlsx → exceljs, .csv → papaparse)
  ├── Parse to plain text with page/sheet markers
  ├── Store in ~/.loop/corpus/, update INDEX.md
  └── Skip if already ingested

loop query "<question>"
  │
  ├── Pi Session (LLM + read/grep/find/ls tools)
  │   ├── Read INDEX.md → discover documents
  │   ├── Grep for keywords → find relevant sections
  │   ├── Read pages → extract answer
  │   └── Cite source → [filename, Page N / Sheet "name"]
  └── Stream answer to terminal
```

**Key design decisions:**
- **No embeddings** — Pi's `grep` + `read` is the retrieval engine. The LLM decides what to search for
- **No vector store** — plain text files with page/sheet markers. `grep` scales to hundreds of documents
- **No chunking** — documents stay whole. Pi reads specific line ranges using `offset`/`limit`
- **Pre-parsed at ingest** — files converted to text once. Queries read plain text (fast)

## Project Structure

```
src/
├── index.ts              # CLI entry point (commander)
├── commands/
│   ├── ingest.ts         # loop ingest — routing, folder scan, incremental
│   └── query.ts          # loop query — Pi session, streaming
├── core/
│   ├── corpus.ts         # Corpus manager (store, index, metadata)
│   └── session.ts        # Pi session factory (LLM + tools + system prompt)
└── parsers/
    ├── types.ts          # ParseResult interface
    ├── pdf.ts            # PDF → Python child_process
    ├── excel.ts          # Excel → exceljs
    └── csv.ts            # CSV → papaparse

python/
└── parse_pdf.py          # PyMuPDF PDF-to-text with page markers

fixtures/                 # Test data (PDFs, Excel, CSV)
tests/acceptance/         # Real files, real LLM calls, no mocks
```

## Testing

Tests are **acceptance tests only** — real files, real LLM calls, real file I/O. No mocks. Ever.

```bash
npm run test
```

## Roadmap

- [x] **EPIC 1** — Single PDF → Query → Cited Answer
- [x] **EPIC 2** — Excel, CSV, folder ingestion, cross-format conflict detection
- [ ] **EPIC 3** — Feedback loop (pass/fail, annotations)
- [ ] **EPIC 4** — FinanceBench demo + benchmark (336 SEC filings, 150 QA pairs)
- [ ] **EPIC 5** — Eval loop (the curve: baseline → annotate → improve → re-run)
- [ ] **EPIC 6** — Ship v1.0

## License

MIT
