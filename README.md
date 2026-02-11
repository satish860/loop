# Loop 🔄

**AI that learns from every correction.**

Loop is a CLI tool that ingests documents (PDF, Excel, CSV), answers questions with citations, and improves accuracy through an eval feedback loop.

```
loop ingest ./portfolio/          # Parse documents into searchable text
loop chat                         # Ask questions, get cited answers
loop eval --benchmark custom      # Measure accuracy
loop eval --improve               # Learn from mistakes
loop eval --history               # Track the curve ↗
```

---

## The Curve

This is the product. Not the chat. Not the search. **The curve.**

```
  Accuracy over time
  ──────────────────────────────────────────────────

  Run 1  ████████████████░░░░░░░░░░░░░░░░  52%  baseline
  Run 2  ████████████████████████░░░░░░░░  68%  +16%  fix: numerical extraction
  Run 3  ██████████████████████████████░░  81%  +13%  fix: cross-doc references
  Run 4  ████████████████████████████████  89%   +8%  fix: date parsing

  Every cycle: measure → analyze failures → improve → measure again.
```

Loop generates QA benchmarks from your documents, measures accuracy, analyzes failure patterns, and suggests improvements. Accuracy goes up with every cycle.

---

## Install

```bash
npm install -g loop-ai
```

Requires Node.js 18+. Python 3.10+ needed only for PDF parsing (`pip install pymupdf4llm`). Excel and CSV work without Python.

---

## Quick Start

### Option 1: Interactive demo

```bash
loop demo
```

Downloads 10 real SEC filings (AMD, Boeing, Microsoft, PepsiCo, Nike, Pfizer, Best Buy, American Express, General Mills, J&J — 1,792 pages total) from [FinanceBench](https://github.com/patronus-ai/financebench). Interactive walkthrough with suggested queries across different capability types.

### Option 2: Your own documents

```bash
loop ingest ./your-docs/          # Ingest a folder of PDFs, Excel, CSV
loop chat                         # Start asking questions
```

---

## Commands

### `loop ingest <source>`

Parse and ingest documents. Supports PDF, Excel (.xlsx/.xls), and CSV.

```bash
loop ingest report.pdf            # Single file
loop ingest ./portfolio/          # Folder (recursive)
loop ingest data.xlsx             # Excel spreadsheet
```

Re-running skips already-ingested files. Each document is classified by type (lease, amendment, financial report, etc.) and indexed.

### `loop chat`

Interactive multi-turn conversation about your documents.

```bash
loop chat                         # Default persona
loop chat --persona finance       # Finance-tuned answers
loop chat --persona legal         # Legal analysis style
```

Features:
- Multi-turn context (follow-up questions work)
- Tool progress shown in real-time (`▸ Reading...`, `▸ Searching...`)
- Page-level citations on every answer
- Session logging for later analysis
- `/new` to start fresh, `/quit` to exit

### `loop query <question>`

One-shot query for scripting and pipelines.

```bash
loop query "What is the lease term for MSN 4521?"
loop query "Total revenue?" --json              # JSON output
loop query "Risk factors?" --persona executive  # Brief style
```

### `loop generate-qa`

Generate QA benchmark pairs from your corpus.

```bash
loop generate-qa --count 30       # Generate 30 QA pairs
loop generate-qa --export csv     # Export for human review
# ... edit the CSV: keep, edit, or discard each pair ...
loop generate-qa --import reviewed.csv   # Import as benchmark
loop generate-qa --from-chats     # Mine QA pairs from chat logs
```

Each QA pair is tagged with dimensions (question type, difficulty, source format, edge cases) for granular error analysis.

### `loop eval`

Run benchmarks, analyze failures, improve accuracy.

```bash
loop eval --benchmark custom            # Run the benchmark
loop eval --analyze                     # Error analysis by dimension
loop eval --judge-create                # Build an LLM judge
loop eval --improve                     # Suggest prompt improvement
loop eval --history                     # Show the curve
loop eval --benchmark custom@v1         # Run specific version
```

### `loop demo`

Interactive walkthrough with 10 real SEC filings from FinanceBench.

```bash
loop demo                         # Interactive (pick queries or type your own)
loop demo --quick                 # Download + ingest only, no queries
```

### `loop status`

Show corpus stats, persona, session history, and signal counts.

### `loop config`

```bash
loop config show                  # Current settings
loop config set persona finance   # Change persona
```

---

## The Eval Loop

This is how Loop gets better:

```
1. Ingest documents
   loop ingest ./docs/

2. Generate benchmark
   loop generate-qa --count 30
   loop generate-qa --export csv
   # Human reviews CSV → keeps good pairs, fixes bad ones
   loop generate-qa --import reviewed.csv

3. Measure baseline
   loop eval --benchmark custom
   → Accuracy: 52%

4. Analyze failures
   loop eval --analyze
   → Worst: numerical questions (31% accuracy)
   → Root cause: misreading tabular data

5. Improve
   loop eval --improve
   → Suggested: "When answering numerical questions, search
     for the exact table, read the full row, and verify units."
   → Applied to system prompt

6. Re-measure
   loop eval --benchmark custom
   → Accuracy: 68% (+16%)

7. Repeat
   loop eval --history
   → The curve goes up ↗
```

---

## Personas

| Persona | Style | Best for |
|---------|-------|----------|
| `general` | Balanced, clear | Default |
| `portfolio_manager` | Asset values, returns, portfolio view | Investment oversight |
| `finance` | Calculations, breakdowns, per-unit costs | Financial analysis |
| `legal` | Clause references, contractual language | Contract review |
| `technical` | Specs, serial numbers, maintenance | Technical due diligence |
| `executive` | Brief, high-level, key takeaways | Quick decisions |
| `junior` | Explanations, context, approachable | Learning / onboarding |

```bash
loop config set persona finance   # Set default
loop chat --persona legal         # Override per session
loop query "..." --persona executive  # Override per query
```

---

## Architecture

Loop is a Node.js/TypeScript CLI. Documents are pre-parsed at ingest into plain text with page/sheet markers. At query time, the AI reads the plain text using file tools (read, grep, search). **No embeddings. No vector store. No RAG pipeline.** File search IS the retrieval.

```
┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ PDF     │    │          │    │ Plain    │    │          │
│ Excel   │───▶│  Ingest  │───▶│ Text     │───▶│  Query   │──▶ Answer
│ CSV     │    │          │    │ Corpus   │    │          │    + Citation
└─────────┘    └──────────┘    └──────────┘    └──────────┘
                                                    │
                                               ┌────┴────┐
                                               │  Eval   │
                                               │  Loop   │──▶ The Curve
                                               └─────────┘
```

### Storage

All data is in `~/.loop/`:

```
~/.loop/
├── corpus/          # Parsed text files + INDEX.md
├── config.json      # Persona, model settings
├── chat-logs/       # Session JSONL files
├── benchmarks/      # QA pairs (draft, reviewed, versioned)
├── eval/            # Eval runs, judge, improvements
└── system.md        # Current system prompt (auto-improved)
```

---

## Requirements

- **Node.js** 18+ (required)
- **Python** 3.10+ with `pymupdf4llm` (required for PDF parsing only)
- **LLM API key** — Anthropic (Claude) or compatible provider

```bash
# Python setup (for PDF support)
pip install pymupdf4llm
```

---

## License

MIT
