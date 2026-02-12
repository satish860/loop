# Loop 🔄

[![CI](https://github.com/satish860/loop/actions/workflows/ci.yml/badge.svg)](https://github.com/satish860/loop/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@deltaxy/loop.svg)](https://www.npmjs.com/package/@deltaxy/loop)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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
npm install -g @deltaxy/loop
```

Requires Node.js 18+. Python 3.10+ needed only for PDF parsing (`pip install pymupdf4llm`). Excel and CSV work without Python.

### LLM Provider Setup

Loop uses [Pi SDK](https://github.com/niceBoy-CEO/pi-coding-agent) for LLM reasoning. Configure your provider:

```bash
# Anthropic (recommended)
export ANTHROPIC_API_KEY=sk-ant-...

# Or OpenRouter (for model variety)
export OPENROUTER_API_KEY=sk-or-...
```

---

## Quick Start

### Option 1: Interactive demo (no setup needed)

```bash
loop demo
```

Downloads 10 real SEC filings (Best Buy, AMD, Boeing, Microsoft, PepsiCo, Nike, Pfizer, American Express, General Mills, J&J — 1,792 pages) from [FinanceBench](https://github.com/patronus-ai/financebench). Interactive walkthrough with 5 suggested query types.

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

Re-running skips already-ingested files. Each document is auto-classified by type (lease, amendment, financial report, etc.) and indexed.

### `loop chat`

Interactive multi-turn conversation with citations.

```bash
loop chat                         # Default persona
loop chat --persona finance       # Finance-tuned answers
loop chat --persona legal         # Legal analysis style
```

Features:
- Multi-turn context (follow-up questions work)
- Tool progress in real-time (`▸ Reading...`, `▸ Searching...`)
- Page-level citations on every answer
- Session logging for later analysis
- `/new` to start fresh, `/quit` to exit

### `loop query <question>`

One-shot query for scripting and pipelines.

```bash
loop query "What is the lease term for MSN 4521?"
loop query "Total revenue?" --json              # Structured JSON output
loop query "Risk factors?" --persona executive  # Brief style
```

Exit code 0 on success, 1 on error. Progress goes to stderr, answer to stdout — pipe-safe.

### `loop generate-qa`

Generate QA benchmark from your corpus.

```bash
loop generate-qa --count 30       # Generate 30 QA pairs
loop generate-qa --export csv     # Export for human review
# ... edit the CSV: keep, edit, or discard each pair ...
loop generate-qa --import reviewed.csv   # Import as benchmark v1
loop generate-qa --from-chats     # Mine QA pairs from chat history
```

Each pair is tagged with dimensions (question type, difficulty, source format, edge cases) for granular error analysis.

### `loop eval`

The eval loop — measure, analyze, improve, repeat.

```bash
loop eval --benchmark custom            # Run benchmark, get accuracy
loop eval --analyze                     # Failure analysis by dimension
loop eval --judge-create                # Build domain-specific LLM judge
loop eval --improve                     # AI suggests prompt improvement
loop eval --history                     # Show THE CURVE
loop eval --benchmark custom@v1         # Run specific version
```

### `loop demo`

Interactive walkthrough with real SEC filings.

```bash
loop demo                         # Full demo (ingest + interactive queries)
loop demo --quick                 # Ingest only, skip queries
```

### `loop status`

Corpus stats, persona, session history, signal counts.

### `loop config`

```bash
loop config show                  # Current settings
loop config set persona finance   # Change default persona
```

---

## The Eval Loop (Step by Step)

This is how Loop gets better over time:

```bash
# 1. Ingest your documents
loop ingest ./docs/

# 2. Generate a benchmark
loop generate-qa --count 30
loop generate-qa --export csv
# Human reviews CSV → keeps good pairs, fixes bad ones, discards noise
loop generate-qa --import reviewed.csv    # → benchmark v1

# 3. Measure baseline
loop eval --benchmark custom
# → Accuracy: 52%

# 4. Analyze failures
loop eval --analyze
# → Worst: numerical questions at 31% accuracy
# → Pattern: misreading tabular data

# 5. Improve
loop eval --improve
# → Suggests: "When answering numerical questions, read the full table row
#    and verify units before responding."
# → Applied to system prompt

# 6. Re-measure
loop eval --benchmark custom
# → Accuracy: 68% (+16%)

# 7. See the curve
loop eval --history
# → The curve goes up ↗
```

---

## Personas

| Persona | Style | Best for |
|---------|-------|----------|
| `general` | Balanced, clear | Default |
| `portfolio_manager` | Asset focus, returns, portfolio view | Investment oversight |
| `finance` | Calculations, rates, per-unit breakdowns | Financial analysis |
| `legal` | Clause references, contractual precision | Contract review |
| `technical` | Specs, serial numbers, maintenance data | Technical due diligence |
| `executive` | Brief, high-level, key takeaways | Quick decisions |
| `junior` | Explanations, context, approachable | Learning & onboarding |

```bash
loop config set persona finance         # Set default
loop chat --persona legal               # Override per session
loop query "..." --persona executive    # Override per query
```

---

## Architecture

Documents are pre-parsed at ingest into plain text with page/sheet markers. At query time, the AI reads files using native tools (read, grep, search). **No embeddings. No vector store. No RAG pipeline.** File search IS the retrieval.

```
┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ PDF     │    │          │    │ Plain    │    │          │
│ Excel   │───▶│  Ingest  │───▶│ Text     │───▶│  Query   │──▶ Answer
│ CSV     │    │          │    │ Corpus   │    │          │    + Citation
└─────────┘    └──────────┘    └──────────┘    └──────────┘
                                                    │
                                               ┌────┴────┐
                                               │  Eval   │
                                               │  Loop   │──▶ The Curve ↗
                                               └─────────┘
```

### How it works

1. **Ingest** — PDFs parsed via PyMuPDF4LLM with `--- PAGE N ---` markers. Excel sheets become pipe-delimited tables. CSV stays as-is with headers.
2. **Index** — Every document listed in `INDEX.md` with type classification. This is the AI's table of contents.
3. **Query** — AI reads INDEX.md, picks relevant files, greps for keywords, reads specific pages. Cites `[filename, Page N]`.
4. **Eval** — QA pairs with expected answers. AI answers each, LLM grader scores pass/fail. Dimensions enable slice-and-dice analysis.
5. **Improve** — Reflector analyzes failure patterns, Curator proposes prompt delta, Tester validates no regressions.

### Storage

All data in `~/.loop/`:

```
~/.loop/
├── corpus/          # Parsed text files + INDEX.md
├── config.json      # Persona, model settings
├── system.md        # Current system prompt (auto-improved)
├── chat-logs/       # Session JSONL files
├── benchmarks/      # QA pairs (draft, reviewed, versioned)
└── eval/            # Eval runs, judge prompt, improvement history
```

---

## CI

212 acceptance tests. Real LLM calls. No mocks. Runs on every push.

```
 Test Files  34 passed (34)
      Tests  212 passed | 22 skipped (234)
```

---

## Requirements

- **Node.js** 18+ (required)
- **Python** 3.10+ with `pymupdf4llm` (only for PDF parsing)
- **LLM API key** — Anthropic, OpenRouter, or compatible provider

```bash
pip install pymupdf4llm    # PDF support
```

---

## Built for

[DeltaXY](https://deltaxy.com) — aviation leasing consultancy. Loop was built to answer questions across portfolios of aircraft lease documents, fleet spreadsheets, and utilization reports. But it works on any document corpus.

---

## License

MIT
