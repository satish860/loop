import { existsSync } from "node:fs";
import { CorpusManager } from "../core/corpus.js";
import { createLoopSession } from "../core/session.js";

// Dim gray for progress lines
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";

export async function query(question: string): Promise<void> {
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

  console.error(`${DIM}Searching ${docs.length} document${docs.length !== 1 ? "s" : ""}...${RESET}\n`);

  const session = await createLoopSession(corpus.dir);

  let fullResponse = "";
  let answerStarted = false;

  session.subscribe((event) => {
    // Show tool execution progress
    if (event.type === "tool_execution_start") {
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

    // Stream the answer
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      if (!answerStarted) {
        process.stderr.write("\n");
        answerStarted = true;
      }
      const delta = event.assistantMessageEvent.delta;
      process.stdout.write(delta);
      fullResponse += delta;
    }
  });

  await session.prompt(cleaned);

  if (!fullResponse.endsWith("\n")) {
    process.stdout.write("\n");
  }

  session.dispose();
}
