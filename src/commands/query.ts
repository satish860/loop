import { existsSync, writeFileSync } from "node:fs";
import { CorpusManager } from "../core/corpus.js";
import { createLoopSession } from "../core/session.js";
import { captureFeedback } from "../core/feedback.js";
import { resolvePersona } from "../core/config.js";

// Dim gray for progress lines
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";

export interface QueryOptions {
  feedback?: boolean;
  new?: boolean;
  json?: boolean;
  output?: string; // "md" | "json" | "csv"
  persona?: string;
}

export async function query(question: string, opts?: QueryOptions): Promise<void> {
  // Strip wrapping quotes (users type: loop query "\"What is...\"")
  const cleaned = question.replace(/^["']+|["']+$/g, "").trim();

  if (!cleaned) {
    console.error('Error: Empty question. Usage: loop query "your question here"');
    process.exit(1);
  }

  const corpus = new CorpusManager();

  if (!existsSync(corpus.dir)) {
    console.error("No documents ingested. Run `loop ingest <file>` first.");
    process.exit(1);
  }

  const docs = corpus.listDocuments();
  if (docs.length === 0) {
    console.error("No documents ingested. Run `loop ingest <file>` first.");
    process.exit(1);
  }

  const jsonMode = opts?.json ?? false;

  if (!jsonMode) {
    console.error(`${DIM}Searching ${docs.length} document${docs.length !== 1 ? "s" : ""}...${RESET}\n`);
  }

  const persona = resolvePersona(opts?.persona);
  const session = await createLoopSession(corpus.dir, { fresh: opts?.new, persona });

  let fullResponse = "";
  let answerStarted = false;

  session.subscribe((event) => {
    // Show tool execution progress (stderr only, skip in --json mode)
    if (!jsonMode && event.type === "tool_execution_start") {
      const name = event.toolName;
      const input = event.args;

      let detail = "";
      const n = name.toLowerCase();
      if (n === "read" && input?.path) {
        detail = `Reading ${input.path}`;
        if (input.offset) detail += ` (lines ${input.offset}–${input.offset + (input.limit || 100)})`;
      } else if (n === "bash" && input?.command) {
        detail = `Running: ${input.command}`;
      } else if (n === "grep" && input?.pattern) {
        detail = `Searching for "${input.pattern}"${input.path ? ` in ${input.path}` : ""}`;
      } else if (n === "find" && input?.pattern) {
        detail = `Finding ${input.pattern}`;
      } else if (n === "ls") {
        detail = `Listing ${input?.path || "."}`;
      } else {
        detail = name;
      }

      process.stderr.write(`${DIM}  ${CYAN}▸${RESET}${DIM} ${detail}${RESET}\n`);
    }

    // Stream the answer (skip streaming in --json mode — output at end)
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      const delta = event.assistantMessageEvent.delta;
      fullResponse += delta;

      if (!jsonMode) {
        if (!answerStarted) {
          process.stderr.write("\n");
          answerStarted = true;
        }
        process.stdout.write(delta);
      }
    }
  });

  await session.prompt(cleaned);

  // ── Output ──
  if (jsonMode) {
    // --json: structured JSON to stdout
    const output = JSON.stringify({ query: cleaned, answer: fullResponse.trim() });
    process.stdout.write(output + "\n");
  } else {
    if (!fullResponse.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }

  // --output: save to file
  if (opts?.output) {
    const slug = cleaned.slice(0, 40).replace(/[^a-zA-Z0-9]+/g, "_").replace(/_+$/, "").toLowerCase();
    const ext = opts.output;
    const filename = `${slug}.${ext}`;

    if (ext === "json") {
      writeFileSync(filename, JSON.stringify({ query: cleaned, answer: fullResponse }, null, 2), "utf-8");
    } else {
      writeFileSync(filename, fullResponse, "utf-8");
    }
    console.error(`\nSaved: ${filename}`);
  }

  // Feedback prompt (only in --feedback mode)
  if (opts?.feedback) {
    await captureFeedback(cleaned, fullResponse);
  }

  session.dispose();
  process.exit(0);
}
