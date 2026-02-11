import { existsSync, mkdirSync, createWriteStream } from "node:fs";
import { resolve, basename, join } from "node:path";
import { tmpdir } from "node:os";
import { get as httpsGet } from "node:https";
import { createInterface } from "node:readline";
import { parsePdf } from "../parsers/pdf.js";
import { CorpusManager } from "../core/corpus.js";
import { createLoopSession } from "../core/session.js";
import { classifyDocument, docTypeDisplayName } from "../core/classifier.js";

// ANSI
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";

// ── Demo documents — 10 iconic companies ──────────────────

const GITHUB_BASE =
  "https://raw.githubusercontent.com/patronus-ai/financebench/main/pdfs";

const DEMO_DOCS: { file: string; company: string; desc: string }[] = [
  { file: "AMD_2022_10K.pdf", company: "AMD", desc: "Semiconductor, FY2022" },
  { file: "BESTBUY_2023_10K.pdf", company: "Best Buy", desc: "Retail, FY2023" },
  { file: "BOEING_2022_10K.pdf", company: "Boeing", desc: "Aerospace, FY2022" },
  { file: "AMERICANEXPRESS_2022_10K.pdf", company: "American Express", desc: "Financial Services, FY2022" },
  { file: "PEPSICO_2022_10K.pdf", company: "PepsiCo", desc: "Consumer Goods, FY2022" },
  { file: "PFIZER_2021_10K.pdf", company: "Pfizer", desc: "Pharma, FY2021" },
  { file: "NIKE_2023_10K.pdf", company: "Nike", desc: "Apparel, FY2023" },
  { file: "MICROSOFT_2023_10K.pdf", company: "Microsoft", desc: "Technology, FY2023" },
  { file: "GENERALMILLS_2022_10K.pdf", company: "General Mills", desc: "Food, FY2022" },
  { file: "JOHNSON_JOHNSON_2022_10K.pdf", company: "Johnson & Johnson", desc: "Healthcare, FY2022" },
];

// ── Suggested queries — organized by skill ────────────────

interface SuggestedQuery {
  key: string;
  label: string;
  question: string;
  teach: string;       // shown before running — what this demonstrates
  takeaway: string;    // shown after answer — what the user just saw
}

const SUGGESTED: SuggestedQuery[] = [
  {
    key: "1",
    label: "Extract facts from a single filing",
    question: "What are AMD's four reportable business segments as of FY2022?",
    teach:
      "Loop will search a 121-page filing, find the right section, and cite\n" +
      "  the exact page — not summarize the whole document.",
    takeaway:
      "Structured extraction with page citation. An analyst would spend\n" +
      "  10-15 minutes finding this manually.",
  },
  {
    key: "2",
    label: "Pull exact financial numbers",
    question: "What was Boeing's total revenue, net loss, and operating cash flow in FY2022?",
    teach:
      "Financial analysis needs exact numbers, not summaries. Loop will find\n" +
      "  three figures from different sections of a 190-page 10-K.",
    takeaway:
      "Multiple numbers from different sections, each cited. If any number\n" +
      "  were wrong, 'loop eval' would catch it.",
  },
  {
    key: "3",
    label: "Compare across companies",
    question: "Compare the total revenue of PepsiCo, Nike, and General Mills. Which is largest?",
    teach:
      "This reads 3 separate filings (736 pages total), finds the revenue\n" +
      "  figure in each, and synthesizes a ranked comparison.",
    takeaway:
      "Cross-document analysis from 3 filings in one answer. This is the\n" +
      "  kind of work that takes analysts hours.",
  },
  {
    key: "4",
    label: "Thematic analysis across sectors",
    question: "What cybersecurity risks do Microsoft, American Express, and Pfizer each disclose?",
    teach:
      "The hardest type: a tech company, a bank, and a pharma company each\n" +
      "  describe cybersecurity risks differently. Loop must find and compare all three.",
    takeaway:
      "Three industries, three disclosure styles, all cited. Due diligence\n" +
      "  work that typically takes a team half a day.",
  },
  {
    key: "5",
    label: "Find something that isn't there",
    question: "What was Nike's cryptocurrency investment strategy in FY2023?",
    teach:
      "Equally important: Loop should say 'I don't know' when the answer\n" +
      "  isn't in the documents. No hallucination.",
    takeaway:
      "Knowing when to say 'I don't know' is what separates a reliable\n" +
      "  tool from a chatbot that makes things up.",
  },
];

// ── Download ──────────────────────────────────────────────

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const DEMO_PDF_DIR = join(HOME, ".loop", "demo-pdfs");
const DEMO_CORPUS = join(HOME, ".loop", "demo-corpus");

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    mkdirSync(DEMO_PDF_DIR, { recursive: true });
    const file = createWriteStream(dest);
    httpsGet(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        downloadFile(res.headers.location!, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", (err) => { file.close(); reject(err); });
  });
}

async function ensurePdf(fileName: string): Promise<string> {
  const fromFixtures = resolve("fixtures", fileName);
  if (existsSync(fromFixtures)) return fromFixtures;
  const fromDist = resolve(import.meta.dirname, "../../fixtures", fileName);
  if (existsSync(fromDist)) return fromDist;
  const dest = join(DEMO_PDF_DIR, fileName);
  if (existsSync(dest)) return dest;
  const url = `${GITHUB_BASE}/${fileName}`;
  await downloadFile(url, dest);
  return dest;
}

// ── Query runner ──────────────────────────────────────────

async function runQuery(corpusDir: string, question: string): Promise<string> {
  const session = await createLoopSession(corpusDir, { fresh: true });

  let answer = "";
  let lineStart = true;
  let answerStarted = false;

  session.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      const name = event.toolName;
      const input = event.args;
      let detail = "";
      const n = name.toLowerCase();
      if (n === "read" && input?.path) {
        detail = `Reading ${input.path}`;
        if (input.offset) detail += ` (lines ${input.offset}–${input.offset + (input.limit || 100)})`;
      } else if (n === "bash" && input?.command) {
        detail = `${input.command}`;
      } else if (n === "grep" && input?.pattern) {
        detail = `Searching for "${input.pattern}"${input.path ? ` in ${input.path}` : ""}`;
      } else {
        detail = name;
      }
      process.stderr.write(`    ${DIM}${CYAN}▸${RESET}${DIM} ${detail}${RESET}\n`);
    }

    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      const delta = event.assistantMessageEvent.delta;
      answer += delta;
      // Skip leading blank lines from the LLM
      if (!answerStarted) {
        if (delta.trim() === "") return;
        process.stdout.write("\n");
        answerStarted = true;
      }
      for (const ch of delta.split("")) {
        if (lineStart) { process.stdout.write("  "); lineStart = false; }
        process.stdout.write(ch);
        if (ch === "\n") lineStart = true;
      }
    }
  });

  await session.prompt(question);
  session.dispose();
  if (!answer.endsWith("\n")) process.stdout.write("\n");
  return answer;
}

// ── Readline helpers ──────────────────────────────────────

function ask(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  return new Promise((res) => rl.question(prompt, res));
}

// ── Main ──────────────────────────────────────────────────

export async function demo(opts?: { quick?: boolean }): Promise<void> {

  // ── Banner ──
  console.log();
  console.log(`  ${BOLD}Loop Demo${RESET}`);
  console.log(`  ${DIM}${"─".repeat(60)}${RESET}`);
  console.log();
  console.log(`  ${DIM}10 real SEC filings from FinanceBench (public benchmark):${RESET}`);
  console.log(`  ${DIM}AMD · Best Buy · Boeing · American Express · PepsiCo${RESET}`);
  console.log(`  ${DIM}Pfizer · Nike · Microsoft · General Mills · J&J${RESET}`);
  console.log();

  // ── Step 1: Download + Ingest ──
  console.log(`  ${BOLD}Step 1: Download & Ingest${RESET}`);
  console.log(`  ${DIM}─────────────────────────${RESET}`);

  const corpus = new CorpusManager(DEMO_CORPUS);
  let totalPages = 0;

  for (const doc of DEMO_DOCS) {
    const name = doc.file;

    if (corpus.isIngested(name)) {
      const meta = corpus.listDocuments().find((d) => d.source === name);
      const pages = meta?.pages ?? 0;
      totalPages += pages;
      console.log(`  ${DIM}✓ ${doc.company.padEnd(20)} ${pages} pages${RESET}`);
      continue;
    }

    process.stdout.write(`  ⏳ ${doc.company.padEnd(20)} downloading...`);
    let pdfPath: string;
    try {
      pdfPath = await ensurePdf(name);
      process.stdout.write(`\r  ⏳ ${doc.company.padEnd(20)} parsing...      `);
    } catch (err: any) {
      process.stdout.write(`\r  ${YELLOW}⚠  ${doc.company.padEnd(20)} download failed: ${err.message}${RESET}\n`);
      continue;
    }

    const tmpOut = join(tmpdir(), `loop-demo-${Date.now()}-${name}.txt`);
    try {
      const result = await parsePdf(pdfPath, tmpOut);
      const docType = await classifyDocument(result.outputPath);
      corpus.addDocument(result, docType);
      totalPages += result.pages ?? 0;
      process.stdout.write(
        `\r  ${GREEN}✅ ${doc.company.padEnd(20)}${RESET} ${result.pages} pages\n`
      );
    } catch (err: any) {
      process.stdout.write(`\r  ${YELLOW}⚠  ${doc.company.padEnd(20)} parse error: ${err.message}${RESET}\n`);
    }
  }

  const totalDocs = corpus.listDocuments().length;
  console.log();
  console.log(`  ${GREEN}${BOLD}Corpus ready: ${totalDocs} documents, ${totalPages.toLocaleString()} pages${RESET}`);
  console.log();

  if (totalDocs < 3) {
    console.log(`  ${YELLOW}Not enough documents for a full demo.${RESET}`);
    return;
  }

  // ── Quick mode: skip interactive ──
  if (opts?.quick) {
    console.log(`  ${DIM}--quick: skipping interactive session${RESET}`);
    showNextSteps();
    return;
  }

  // ── Interactive session ──
  console.log(`  ${BOLD}Step 2: Ask questions${RESET}`);
  console.log(`  ${DIM}─────────────────────${RESET}`);
  console.log();
  console.log(`  ${DIM}Try a suggested question, or type your own.${RESET}`);
  console.log(`  ${DIM}Type ${RESET}quit${DIM} to exit.${RESET}`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let queriesRun = 0;

  while (true) {
    // Show menu
    console.log();
    showMenu(queriesRun);
    console.log();

    let input: string;
    try {
      input = await ask(rl, `  ${MAGENTA}Your choice (1-5) or type a question: ${RESET}`);
    } catch {
      break; // stdin closed (piped input)
    }
    const trimmed = input.trim();

    if (!trimmed || trimmed.toLowerCase() === "quit" || trimmed.toLowerCase() === "q") {
      break;
    }

    // Match to suggested or treat as free-form
    const suggested = SUGGESTED.find((s) => s.key === trimmed);
    let question: string;
    let teach: string | undefined;
    let takeaway: string | undefined;

    if (suggested) {
      question = suggested.question;
      teach = suggested.teach;
      takeaway = suggested.takeaway;
      console.log();
      console.log(`  ${BOLD}${suggested.label}${RESET}`);
      console.log(`  ${DIM}${teach}${RESET}`);
    } else {
      question = trimmed;
    }

    console.log();
    console.log(`  ${CYAN}Q: ${question}${RESET}`);

    try {
      await runQuery(DEMO_CORPUS, question);
    } catch (err: any) {
      console.log(`\n  ${YELLOW}Error: ${err.message}${RESET}`);
    }

    if (takeaway) {
      console.log();
      console.log(`  ${GREEN}↳ ${takeaway}${RESET}`);
    }

    queriesRun++;
  }

  rl.close();

  console.log();
  if (queriesRun === 0) {
    console.log(`  ${DIM}No questions asked. Run 'loop demo' anytime to try again.${RESET}`);
  } else {
    console.log(`  ${DIM}You ran ${queriesRun} ${queriesRun === 1 ? "query" : "queries"} across ${totalPages.toLocaleString()} pages.${RESET}`);
  }

  showNextSteps();
}

// ── Menu ──────────────────────────────────────────────────

function showMenu(queriesRun: number) {
  if (queriesRun === 0) {
    console.log(`  ${DIM}Suggested queries — each shows a different capability:${RESET}`);
  } else {
    console.log(`  ${DIM}Try another, or type your own question about any of the 10 filings:${RESET}`);
  }
  console.log();
  for (const s of SUGGESTED) {
    console.log(`  ${BOLD}${s.key}${RESET}  ${s.label}`);
  }
  console.log();
  console.log(`  ${DIM}Or type any question — Loop has 10 filings (1,792 pages) to search.${RESET}`);
}

// ── Next steps ────────────────────────────────────────────

function showNextSteps() {
  console.log();
  console.log(`  ${BOLD}What's Next${RESET}`);
  console.log(`  ${DIM}${"─".repeat(60)}${RESET}`);
  console.log();
  console.log(`  ${DIM}Use Loop with your own documents:${RESET}`);
  console.log();
  console.log(`    loop ingest ./your-docs/           ${DIM}# Ingest PDFs, Excel, CSV${RESET}`);
  console.log(`    loop chat                          ${DIM}# Interactive conversation${RESET}`);
  console.log(`    loop chat --persona finance        ${DIM}# Finance-tuned answers${RESET}`);
  console.log(`    loop generate-qa --count 20        ${DIM}# Build a QA benchmark${RESET}`);
  console.log(`    loop eval --benchmark custom       ${DIM}# Measure accuracy${RESET}`);
  console.log(`    loop eval --improve                ${DIM}# Improve from failures${RESET}`);
  console.log(`    loop eval --history                ${DIM}# Track the curve${RESET}`);
  console.log();
  console.log(`  ${BOLD}The eval loop:${RESET} measure → analyze failures → improve → measure again.`);
  console.log(`  ${DIM}Accuracy goes up with every cycle. That's Loop.${RESET}`);
  console.log();
}
