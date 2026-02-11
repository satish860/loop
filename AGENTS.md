# Loop V1 — Agent Context

> **Read this first.** This file is the persistent memory for any AI agent working on Loop.
> It explains what Loop is, how the project works, where everything lives, and what to do next.
> Updated as work progresses.

---

## What Is Loop

Loop is a CLI tool that ingests documents (PDF, Excel, CSV), answers questions with citations, and **improves accuracy through an eval feedback loop**. The tagline: "AI that learns from every correction."

```
loop ingest ./portfolio/                    # Parse documents into plain text
loop query "What is the lease term?"        # Pi answers with source + page citation
loop eval --benchmark financebench          # Run 150 questions, get accuracy score
```

Built for DeltaXY (aviation leasing consultancy). Ships March 14, 2026.

---

## Philosophy

**Default is simple. Simple is good enough. Simple is reliable.**

- If there's a simple way and a clever way, pick simple.
- If the test passes, the story is done. Don't gold-plate.
- The eval loop catches what simple gets wrong — that's the product.

---

## Architecture (One Paragraph)

Loop is a **Node.js/TypeScript CLI** that embeds the **Pi coding agent SDK** as its AI engine. Pi provides LLM reasoning + tools (read, bash, grep, write). Loop adds document parsing, feedback capture, and eval orchestration. Documents are **pre-parsed at ingest** into plain text with page/sheet markers. Pi reads the plain text at query time using its native tools. **No embeddings. No vector store. No SQLite. No RAG pipeline.** Pi's `read` + `grep` IS the retrieval. Python is used only for PDF parsing (PyMuPDF4LLM).

---

## Design Principles

```
0. Simple by default.           If it works, don't add to it.
1. Pi does the thinking.        Loop does the product.
2. Plain files over databases.  JSON/JSONL/MD. No SQLite.
3. Pre-parse at ingest.         Pi reads plain text at query time.
4. Acceptance tests only.       Real LLM calls. No mocks. Ever.
5. Kanban workflow.             Demoable increments. WIP limits.
6. Node.js primary.             Python only for PDF parsing.
```

---

## Testing Rules

**Acceptance tests only. No unit tests. No mocks. Ever.**

- Every test uses real files, real parsers, real LLM calls.
- Tests are in `tests/acceptance/`.
- Use `vitest` as test runner.
- A story is DONE when its acceptance test passes.
- Don't write tests for internal functions. Test the CLI behavior.

---

## Kanban Rules

```
1. One EPIC in progress at a time (WIP limit = 1 EPIC)
2. Stories within an EPIC can be parallelized
3. EPIC is DONE when its demo works end-to-end
4. Don't start next EPIC until current one demos
5. If something blocks, note it and move to next story in same EPIC
6. Demo every Friday
```

### Story Lifecycle

```
BACKLOG → IN PROGRESS → DONE

To move to IN PROGRESS:
  - Read the story in BACKLOG_LOOP_V1.md
  - Understand the success criteria and acceptance test
  - Build it

To move to DONE:
  - All success criteria met
  - Acceptance test passes
  - Update this file (Agents.md) with what was built
```

---

## Folder Structure

```
C:\code\loop\                   ← Project root (Git repo)
├── AGENTS.md                   ← This file (Pi reads at startup)
├── project-docs/               ← Planning docs (gitignored)
│   ├── BACKLOG_LOOP_V1.md
│   ├── DESIGN_LOOP_V1.md
│   ├── KANBAN.md
│   ├── SPEC_LOOP_V1.md
│   ├── PRD_LOOP_V1_MILESTONE.md
│   ├── PRD_DOCUMENT_INTELLIGENCE_PLATFORM.md
│   └── DISCUSSION_ENTERPRISE_SEARCH.md
├── src/                        ← Source code (pushed to GitHub)
├── python/                     ← PDF parser
├── tests/                      ← Acceptance tests
└── fixtures/                   ← Test fixture files
```

`AGENTS.md` stays at root so Pi finds it. `project-docs/` is gitignored — planning docs don't ship.

## Project Files

**Root** — `AGENTS.md` (this file, always read first)

**Docs** (`project-docs/`):

| File | Purpose | When to Read |
|------|---------|-------------|
| `BACKLOG_LOOP_V1.md` | All stories with success criteria + acceptance tests | When starting a story |
| `DESIGN_LOOP_V1.md` | Full technical architecture, module structure, SDK integration | When building core components |
| `SPEC_LOOP_V1.md` | 21 CLI scenarios with exact expected output | When implementing CLI commands |
| `KANBAN.md` | Live Kanban board — current story tasks | Check status |
| `PRD_LOOP_V1_MILESTONE.md` | Product requirements, timeline, what/why | For product context |
| `DISCUSSION_ENTERPRISE_SEARCH.md` | Enterprise scale analysis + QMD research | Only if scale issues arise |

**Code** (root level):

| Path | Purpose |
|------|---------|
| `package.json` | Node.js project config |
| `tsconfig.json` | TypeScript config |
| `src/` | All source code |
| `python/` | PDF parser (PyMuPDF4LLM) |
| `tests/` | Acceptance tests |
| `fixtures/` | Test fixture files |

---

## Module Structure

```
loop/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                  # CLI entry point (commander)
│   ├── commands/
│   │   ├── ingest.ts             # loop ingest
│   │   ├── query.ts              # loop query
│   │   ├── eval.ts               # loop eval
│   │   ├── demo.ts               # loop demo
│   │   ├── status.ts             # loop status
│   │   └── config.ts             # loop config
│   ├── core/
│   │   ├── session.ts            # Pi AgentSession creation
│   │   ├── corpus.ts             # Corpus management + INDEX.md
│   │   ├── annotations.ts        # Read/write annotations.jsonl
│   │   └── feedback.ts           # Pass/fail capture flow
│   ├── parsers/
│   │   ├── pdf.ts                # PDF → Python child_process
│   │   ├── excel.ts              # Excel → exceljs
│   │   ├── csv.ts                # CSV → papaparse
│   │   └── types.ts              # ParseResult interface
│   └── eval/
│       ├── judge.ts              # LLM judge
│       ├── benchmark.ts          # FinanceBench runner
│       └── history.ts            # The curve
├── python/
│   ├── parse_pdf.py              # PyMuPDF4LLM wrapper
│   └── requirements.txt          # pymupdf4llm
├── tests/
│   └── acceptance/               # Real files, real LLM, no mocks
│       ├── ingest.test.ts
│       ├── query.test.ts
│       └── ...
└── fixtures/                     # Test fixtures (sample docs)
    ├── sample_lease.pdf
    ├── fleet_sample.xlsx
    └── utilization_sample.csv
```

---

## Storage Layout (Runtime)

```
~/.loop/
├── corpus/                     # Parsed texts + INDEX.md
├── annotations.jsonl           # Every pass/fail
├── eval/
│   ├── judge.txt               # Judge prompt
│   ├── history.jsonl           # The curve
│   └── benchmarks/financebench/
├── sessions/                   # Pi session files
├── system.md                   # Current system prompt
└── config.json                 # Model + API key
```

---

## Key Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| `@mariozechner/pi-coding-agent` | Pi SDK — LLM reasoning, tools, sessions | latest |
| `commander` | CLI framework | ^12 |
| `exceljs` | Excel parsing (.xlsx/.xls) | ^4 |
| `papaparse` | CSV parsing | ^5 |
| `vitest` | Test runner | ^3 |
| `pymupdf4llm` (Python) | PDF text extraction | latest |

---

## Parsed Text Formats

**PDF** — simple page markers:
```
--- PAGE 1 ---
AIRCRAFT OPERATING LEASE AGREEMENT
...
--- PAGE 2 ---
TABLE OF CONTENTS
...
```

**Excel** — sheet markers, pipe-delimited rows:
```
--- SHEET "Fleet Overview" ---
MSN | Type | Lessee | Status
MSN 4521 | B777-300ER | Emirates | Active
...
```

**CSV** — header row, pipe-delimited data:
```
MSN | Type | FH_Jan | Status
MSN 4521 | B777-300ER | 0 | In Storage
...
```

No metadata headers. Filename IS the source. First row IS the header. Simple.

---

## The Eval Loop (The Product Differentiator)

```
1. Run benchmark → get baseline accuracy (e.g., 65%)
2. Review failures → label pass/fail with notes
3. Detect patterns → "wrong numerical calculation" is top failure
4. Build judge   → LLM judge trained on human labels
5. Suggest fix   → improve system prompt based on failure patterns
6. Re-run        → accuracy improves (e.g., 81%)
7. The curve     → 65% → 81% tracked over time

This IS the product. Without this, Loop is just another chatbot.
```

---

## Current Status

### EPICs

| # | EPIC | Status | Stories |
|---|------|--------|---------|
| 1 | Single PDF → Query → Answer | ✅ **DONE** | 9 stories |
| 2 | Excel + CSV + Folder Ingest | ✅ **DONE** | 9 stories |
| 3 | Chat + Signal Capture | ✅ **DONE** | 6 stories |
| 4 | Benchmark Builder (Generate QA + Validate) | ✅ **DONE** | 5 stories (1 deferred) |
| 5 | Eval Loop (The Curve) | **IN PROGRESS** | 6 stories |
| 6 | Ship | Backlog | 5 stories |

> **Note:** EPICs 3-6 were rewritten on Feb 10 based on research into ACE paper (Stanford),
> Hamel Husain's eval methodology, Glean AI Evaluator, and OpenAI enterprise evals.
> See `project-docs/BACKLOG_V2_EPICS_3_6.md` for full stories.
> Key changes: Chat replaces one-shot feedback. Generate-QA with dimensions replaces 
> manual pass/fail. Eval runs offline. Persona support added.

### EPIC 1 Stories

| Story | Title | Status |
|-------|-------|--------|
| 1.1 | Project scaffold | ✅ DONE |
| 1.2 | Python PDF parser script | ✅ DONE |
| 1.3 | Node.js PDF parser wrapper | ✅ DONE |
| 1.4 | Corpus manager | ✅ DONE |
| 1.5 | INDEX.md generation | ✅ DONE |
| 1.6 | `loop ingest <file>` CLI | ✅ DONE |
| 1.7 | Pi session with system prompt | ✅ DONE |
| 1.8 | `loop query` CLI | ✅ DONE |
| 1.9 | End-to-end acceptance test | ✅ DONE |

### What's Built

```
✅ Story 1.1 — Project scaffold (Feb 10)
   package.json, tsconfig, vitest, CLI with 6 stub commands
   npm install + build + test all pass
   Python pymupdf4llm verified

✅ Story 1.2 — Python PDF parser (Feb 10)
   python/parse_pdf.py — extracts text with --- PAGE N --- markers
   Tested on BESTBUY_2023_10K.pdf (75 pages)
   stdout + --output flag + error handling

✅ Story 1.3 — Node.js PDF parser wrapper (Feb 10)
   src/parsers/pdf.ts — parsePdf() calls Python via child_process
   src/parsers/types.ts — ParseResult interface
   Returns {source, outputPath, format, pages}

✅ Story 1.4+1.5 — Corpus manager + INDEX.md (Feb 10)
   src/core/corpus.ts — CorpusManager class
   addDocument(), isIngested(), listDocuments()
   Auto-generates INDEX.md on every ingest

✅ Story 1.6 — loop ingest CLI (Feb 10)
   src/commands/ingest.ts — wires parser + corpus + CLI
   loop ingest <file.pdf> → parse → store → INDEX.md → done
   Error handling: missing file, unsupported format

✅ Story 1.7 — Pi session with system prompt (Feb 10)
   src/core/session.ts — createLoopSession(corpusDir)
   Pi SDK embedded, read-only tools, cwd=corpus
   System prompt: read INDEX.md, grep, cite, never hallucinate
   Real LLM test: answers "Minnesota" for Best Buy incorporation state

✅ Story 1.8 — loop query CLI (Feb 10)
   src/commands/query.ts — streams Pi answer to terminal
   loop query "What state is Best Buy incorporated in?"
   → "Minnesota" with citation [BESTBUY_2023_10K.txt, Page 220]

✅ Story 1.9 — End-to-end acceptance test (Feb 10)
   tests/acceptance/epic1-e2e.test.ts — 4 real LLM tests
   Clean corpus → ingest PDF → factual query → numerical query → "I don't know"
   All pass: correct answers, citations present, no hallucination
   EPIC 1 COMPLETE ✅
```

### EPIC 2 Stories

| Story | Title | Status |
|-------|-------|--------|
| 2.1 | Excel parser | ✅ DONE |
| 2.2 | CSV parser | ✅ DONE |
| 2.3 | Ingest routes files to correct parser | ✅ DONE |
| 2.4 | Folder ingest | ✅ DONE |
| 2.5 | Incremental ingest | ✅ DONE |
| 2.6 | Single-format Excel query | ✅ DONE |
| 2.7 | Single-format CSV query | ✅ DONE |
| 2.8 | Cross-format conflict detection | ✅ DONE |
| 2.9 | "I don't know" response | ✅ DONE |

### What's Built (EPIC 2)

```
✅ Fixtures created (Feb 10)
   fixtures/fleet_sample.xlsx — 3 sheets, 10 aircraft, maintenance reserves
   fixtures/utilization_sample.csv — 10 rows, flight hours, storage status
   fixtures/sample_lease.pdf — 3 pages, MSN 4521 lease agreement
   fixtures/sample_amendment.pdf — 1 page, changes engine reserve $350→$420/FH

✅ Story 2.1 — Excel parser (Feb 10)
   src/parsers/excel.ts — parseExcel() using exceljs
   Sheet markers, pipe-delimited rows, header detection

✅ Story 2.2 — CSV parser (Feb 10)
   src/parsers/csv.ts — parseCsv() using papaparse
   Pipe-delimited output, handles empty cells

✅ Story 2.3 — Ingest routing (Feb 10)
   src/commands/ingest.ts — routes .pdf/.xlsx/.xls/.csv to correct parser
   Rejects unsupported formats with clear error

✅ Story 2.4 — Folder ingest (Feb 10)
   loop ingest fixtures/ → scans recursively, ingests all supported files
   Per-file progress with ✅/❌ indicators

✅ Story 2.5 — Incremental ingest (Feb 10)
   Re-running ingest skips already-ingested files
   Shows "already ingested, skipping" message

✅ Story 2.6 — Excel query (Feb 10)
   "What type is MSN 4521?" → "B777-300ER" from fleet spreadsheet

✅ Story 2.7 — CSV query (Feb 10)
   "Which aircraft had zero flight hours?" → "MSN 4521, In Storage"

✅ Story 2.8 — Cross-format conflict detection (Feb 10)
   Detects $350/FH (Excel) vs $420/FH (amendment PDF) conflict
   Cites both sources, notes the change

✅ Story 2.9 — "I don't know" response (Feb 10)
   "What is the insurance requirement?" → correctly says not found
   No hallucination. Lists what was searched.
```

### EPIC 3 Stories

| Story | Title | Status |
|-------|-------|--------|
| 3.1 | Interactive chat session | ✅ DONE |
| 3.2 | Chat session logging | ✅ DONE |
| 3.3 | Implicit signal detection | ✅ DONE |
| 3.4 | Persona support | ✅ DONE |
| 3.5 | `loop status` command | ✅ DONE |
| 3.6 | Keep `loop query` for scripting | ✅ DONE |

### What's Built (EPIC 3)

```
✅ Story 3.1 — Interactive chat session (Feb 10)
   src/core/chat-session.ts — ChatSession class
   src/commands/chat.ts — loop chat CLI with readline
   Multi-turn context, /quit, /new, turn numbers

✅ Story 3.2 — Chat session logging (Feb 10)
   src/core/session-logger.ts — JSONL incremental logging
   Session start/end metadata, turn logging, crash-safe writes
   Logs to ~/.loop/chat-logs/{timestamp}_{sessionId}.jsonl

✅ Story 3.3 — Implicit signal detection (Feb 10)
   src/core/signal-detector.ts — pattern-based signal analysis
   Detects: correction, reformulation, satisfaction, follow_up_depth
   Signals logged to session JSONL as {type: "signal"} entries
   analyzeSession(id) public API for post-session analysis
   Runs automatically on session.end() — non-blocking
   13 tests: 10 pattern tests + 3 real LLM integration tests

✅ Story 3.4 — Persona support (Feb 10)
   src/core/config.ts — config manager (read/write ~/.loop/config.json)
   7 personas: general, portfolio_manager, legal, finance, technical, executive, junior
   Persona prompt injected into system prompt via buildSystemPrompt()
   loop config set persona <type> — persists to config.json
   loop config show — displays current settings
   ChatSession resolves persona: CLI override > config > "general"
   loop chat shows persona on start, loop query --persona <type> for overrides
   14 tests: 11 config tests + 3 real LLM tests (finance/legal/executive styles)

✅ Story 3.5 — loop status command (Feb 10)
   src/commands/status.ts — rewritten with corpus, persona, chat, signal stats
   Shows: doc count by format, current persona, session/turn counts, signal counts
   Scans ~/.loop/chat-logs/ JSONL files for session/signal stats
   Works with empty corpus (shows help message)
   6 tests: empty state, corpus stats, persona display, no sessions, session+signals, empty corpus

✅ Story 3.6 — Keep loop query for scripting (Feb 10)
   src/commands/query.ts — added --json flag, clean exit codes
   --json outputs {"query": "...", "answer": "..."} to stdout (no streaming, no progress)
   --persona works for per-query override
   Exit code 0 on success, 1 on error
   Pipe-safe: progress to stderr, answer to stdout
   6 tests: stdout output, --json valid, --json pipe-clean, error exit code, no noise, --persona
```

### EPIC 4 Stories

| Story | Title | Status |
|-------|-------|--------|
| 4.1 | Document type classification | ✅ DONE |
| 4.2 | Generate QA pairs with dimensions | ✅ DONE |
| 4.3 | Human review flow | ✅ DONE |
| 4.4 | FinanceBench integration | Deferred to EPIC 6 |
| 4.5 | Benchmark versioning | ✅ DONE |

### What's Built (EPIC 4)

```
✅ Story 4.1 — Document type classification (Feb 10)
   src/core/classifier.ts — classifyDocument() using Pi session
   8 predefined types: lease, amendment, purchase, insurance, maintenance, fleet_data, utilization_data, other
   Pi SDK session with classification-specific prompt, no tools needed
   Classification stored in meta.json, shown in INDEX.md as [type] tags
   corpus.setDocType() for updating types after ingest
   Best-effort: empty/unclassifiable text returns "other", errors don't block ingest
   Ingest CLI updated: single-file and folder ingest both classify
   8 tests: 4 fixture classifications (lease, amendment, fleet_data, utilization_data),
            corpus metadata storage, INDEX.md tag, valid type check, empty text fallback

✅ Story 4.2 — Generate QA pairs with dimensions (Feb 10)
   src/core/qa-generator.ts — Pi-powered QA generation with read-only tools
   src/commands/generate-qa.ts — loop generate-qa CLI with progress + coverage display
   Pi session explores corpus: reads INDEX.md, samples each document, greps for key terms
   Generates QA pairs tagged with dimensions: questionType, difficulty, sourceFormat, edgeCase
   Distribution plan: weights by document size, reserves 15% cross-doc + 15% not_answerable
   Targeted follow-ups ensure cross-document and not_answerable pairs are always included
   Priority-based selection: cross-doc and edge case pairs kept over regular pairs when trimming
   Robust JSON parsing: handles raw arrays, code blocks, mixed text
   Saves to ~/.loop/benchmarks/custom/qa-pairs-draft.jsonl (one pair per line)
   Coverage summary: bar chart by question type, difficulty, source format, edge cases
   Tested on real aircraft docs: 14 documents, 15 QA pairs with 5 question types, 3 cross-doc, 3 not_answerable
   10 tests: 5 real LLM tests (generation, cross-doc, not_answerable, coverage, JSONL format)
             + 5 parsing/coverage tests (no LLM)

✅ Story 4.3 — Human review flow (Feb 10)
   src/core/qa-review.ts — CSV export/import with papaparse
   src/commands/generate-qa.ts — added --export csv and --import <file> flags
   Export: reads qa-pairs-draft.jsonl → writes qa-pairs-review.csv (properly quoted)
   Import: reads reviewed CSV → filters keep/edit, discards → saves qa-pairs.jsonl (benchmark)
   Handles: long text with commas/quotes, empty fields, not_answerable edge case
   Validation: rejects empty questions, allows empty answer for not_answerable
   Re-numbers IDs sequentially after discards
   CLI shows helpful next-step instructions after export and import
   11 tests: export columns, long text quoting, custom path, no-draft error,
             keep-all, discard filtering, edit detection, empty question rejection,
             not_answerable handling, missing file error, full roundtrip

✅ Story 4.5 — Benchmark versioning (Feb 10)
   src/core/benchmark-version.ts — version management for benchmarks
   saveBenchmarkVersion() — saves qa-pairs-v{N}.jsonl + updates qa-pairs.jsonl (latest)
   loadVersionedBenchmark() — loads latest or specific version (e.g., "v1")
   listBenchmarkVersions() — lists all versions with metadata
   versions.json manifest: version, timestamp, pairCount, corpusDocCount, systemPromptHash
   Import flow now auto-creates versions: "Imported 5 QA pairs → benchmark v1"
   CLI shows: loop eval --benchmark custom@v1 for specific version
   Previous versions never overwritten — full history preserved
   11 tests: v1 creation, v2 preserves v1, load latest, load specific,
             list all, latest tracking, qa-pairs.jsonl sync, manifest,
             nonexistent version, corpus doc count, optional description

   Story 4.4 (FinanceBench) — Deferred to EPIC 6
   Reason: Custom benchmark on real DeltaXY docs is the priority for March 14.
   FinanceBench (336 PDF download) is a nice-to-have, not a blocker for the eval loop.

   EPIC 4 COMPLETE (4/5 stories done, 1 deferred) ✅
```

### EPIC 5 Stories

| Story | Title | Status |
|-------|-------|--------|
| 5.1 | Eval runner | ✅ DONE |
| 5.2 | Error analysis by dimension | BACKLOG |
| 5.3 | LLM judge with critiques | BACKLOG |
| 5.4 | System prompt improvement | BACKLOG |
| 5.5 | The curve (eval history) | BACKLOG |
| 5.6 | Mine chat logs for QA pairs | BACKLOG |

### What's Built (EPIC 5)

```
✅ Story 5.1 — Eval Runner (Feb 11)
   src/eval/grader.ts — LLM-based semantic answer comparison
   src/eval/runner.ts — orchestrates eval runs (fresh session per pair)
   src/commands/eval.ts — loop eval --benchmark <name> [--limit N] CLI
   Grader: binary pass/fail with one-line reason, handles not_answerable
   Runner: loads benchmark, runs each pair through Pi, grades, saves JSONL
   Storage: ~/.loop/eval/runs/{benchmark}-{timestamp}.jsonl
   Each run: meta line + result lines + summary line (crash-safe incremental writes)
   loadEvalRun(), loadLatestRun(), listEvalRuns() for reading back results
   loop eval (no args) shows run history overview
   Supports --benchmark custom@v1 for versioned benchmarks
   9 tests: grader pass/fail/not_answerable, full eval run, JSONL persistence,
            loadEvalRun, listEvalRuns, --limit, loadLatestRun
```

### Blockers

- None currently

---

## How to Work on a Story

```
1. Read the story in BACKLOG_LOOP_V1.md (success criteria + acceptance test)
2. Read relevant section of DESIGN_LOOP_V1.md (architecture details)
3. Build the simplest thing that passes the acceptance test
4. Run the acceptance test
5. Update Agents.md status table
6. Move to next story
```

### Don'ts

```
- Don't add abstractions "for later"
- Don't add fields "in case"
- Don't write unit tests
- Don't mock anything
- Don't build what the current story doesn't need
- Don't refactor before the e2e test (Story 1.9) passes
```

---

## FinanceBench (Built-in Benchmark)

- **336 SEC filings** (PDF) from 41 companies (2015-2023)
- **150 QA pairs** with expert-verified ground truth
- Source: `github.com/patronus-ai/financebench`
- Filing types: 10-K, 10-Q, 8-K, earnings reports, annual reports
- `loop demo` downloads everything, `loop eval --benchmark financebench` runs it
- This is the real-world scale test for Pi's grep-based retrieval

---

## Week Plan

```
Week 1 (Feb 10-14):  EPIC 1 + EPIC 2                     ✅ DONE
Week 2 (Feb 14-21):  EPIC 3 (Chat + Signals)
Week 3 (Feb 21-28):  EPIC 4 + EPIC 5 (Benchmark + Eval)
Week 4 (Mar 1-14):   EPIC 6 (Ship)
```

---

*Last updated: Feb 10, 2026 — Story 1.1 moved to IN PROGRESS*
