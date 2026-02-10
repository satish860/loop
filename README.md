# Loop

**AI that learns from every correction** — document intelligence CLI powered by [Pi coding agent](https://github.com/nicholasgasior/pi-coding-agent).

Ingest PDFs. Ask questions. Get cited answers with page numbers. Loop improves accuracy through an eval loop — every correction makes the next answer better.

## Demo

```bash
# Ingest a 75-page SEC 10-K filing
$ loop ingest BESTBUY_2023_10K.pdf
Parsing: BESTBUY_2023_10K.pdf
Pages: 75
Stored: BESTBUY_2023_10K.txt (75 pages). Corpus: 1 document

# Ask a question — watch Loop think
$ loop query "What was Best Buy's total revenue for fiscal year 2023?"
Searching 1 document...

  ▸ Reading INDEX.md
  ▸ Searching for "total revenue" in BESTBUY_2023_10K.txt
  ▸ Reading BESTBUY_2023_10K.txt (lines 8595–8615)

Best Buy's total revenue for fiscal year 2023 was **$46,298 million**.

"Total revenue $ 46,298"

**Source: [BESTBUY_2023_10K.pdf, Page 62]**
```

## How It Works

Loop embeds the Pi coding agent SDK — an LLM with `read`, `grep`, `find`, and `ls` tools. No embeddings. No vector database. No chunking pipeline.

1. **Ingest** — PDFs are parsed into plain text with `--- PAGE N ---` markers
2. **Query** — Pi reads the corpus index, greps for keywords, reads relevant pages, and answers with citations
3. **Eval** *(coming soon)* — Track accuracy over time. Every correction feeds back into the system prompt

The LLM decides how to explore documents. It decomposes questions, searches iteratively, and cites sources — the same way a human analyst would.

## Install

```bash
# Prerequisites
node >= 18
python >= 3.10

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
# Ingest a PDF
loop ingest <file.pdf>

# Ask a question
loop query "What is the lease term for MSN 4521?"

# Check corpus status
loop status

# Run eval loop (coming soon)
loop eval
```

## Architecture

```
loop ingest <file>
  │
  ├── Python (PyMuPDF) → parse PDF to text with page markers
  ├── Corpus Manager   → store in ~/.loop/corpus/, update INDEX.md
  └── Done

loop query "<question>"
  │
  ├── Pi Session (LLM + read/grep/find/ls tools)
  │   ├── Read INDEX.md → discover documents
  │   ├── Grep for keywords → find relevant sections
  │   ├── Read pages → extract answer
  │   └── Cite source → [filename.pdf, Page N]
  └── Stream answer to terminal
```

**Key design decisions:**
- **No embeddings** — Pi's `grep` + `read` is the retrieval engine. The LLM decides what to search for
- **No vector store** — plain text files with page markers. `grep` scales to hundreds of documents
- **No chunking** — documents stay whole. Pi reads specific line ranges using `offset`/`limit`
- **Pre-parsed at ingest** — PDFs converted to text once. Queries read plain text (fast)

## Project Structure

```
src/
├── index.ts              # CLI entry point (commander)
├── commands/
│   ├── ingest.ts         # loop ingest command
│   └── query.ts          # loop query command
├── core/
│   ├── corpus.ts         # Corpus manager (store, index, track)
│   └── session.ts        # Pi session factory (LLM + tools + system prompt)
└── parsers/
    ├── types.ts          # ParseResult interface
    └── pdf.ts            # Node.js wrapper for Python PDF parser

python/
└── parse_pdf.py          # PyMuPDF PDF-to-text with page markers

tests/
└── acceptance/           # Real files, real LLM calls, no mocks
    ├── scaffold.test.ts
    ├── pdf-parser.test.ts
    ├── parsers.test.ts
    ├── corpus.test.ts
    ├── ingest.test.ts
    ├── query.test.ts
    └── session.test.ts
```

## Testing

Tests are **acceptance tests only** — real PDFs, real LLM calls, real file I/O. No mocks.

```bash
npm run test     # 30 tests, ~30s (includes LLM calls)
```

## Roadmap

- [x] **EPIC 1** — Single PDF → Query → Cited Answer
- [ ] **EPIC 2** — Excel, CSV, folder ingestion
- [ ] **EPIC 3** — Feedback loop (thumbs up/down, corrections)
- [ ] **EPIC 4** — FinanceBench demo + benchmark
- [ ] **EPIC 5** — Eval loop (accuracy tracking over time)
- [ ] **EPIC 6** — Ship v1.0

## License

MIT
