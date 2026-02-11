import * as readline from "node:readline";
import { ChatSession } from "../core/chat-session.js";
import { personaDisplayName } from "../core/config.js";

// ANSI codes
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";

export interface ChatCommandOptions {
  persona?: string;
}

export async function chat(opts?: ChatCommandOptions): Promise<void> {
  let session: ChatSession;

  try {
    session = new ChatSession(undefined, { persona: opts?.persona });
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }

  // Wire up tool progress display
  session.onToolProgress = (detail) => {
    process.stderr.write(`${DIM}  ${CYAN}▸${RESET}${DIM} ${detail}${RESET}\n`);
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`${BOLD}Loop Chat${RESET} — ask questions about your documents`);
  console.log(`${DIM}Commands: /quit (exit), /new (fresh session)${RESET}`);
  console.log(`${DIM}Persona: ${personaDisplayName(session.persona)}${RESET}`);
  console.log();

  let turnNum = 0;
  let answering = false;
  let exited = false;

  const promptUser = () => {
    turnNum++;
    rl.question(`${GREEN}[${turnNum}] You:${RESET} `, async (input) => {
      const trimmed = input.trim();

      // Handle commands
      if (!trimmed || trimmed === "/quit" || trimmed === "/exit") {
        exited = true;
        const summary = await session.end();
        console.log(
          `\n${DIM}Session ended. ${summary.totalTurns} turn${summary.totalTurns !== 1 ? "s" : ""}.${RESET}`
        );
        rl.close();
        return;
      }

      if (trimmed === "/new") {
        await session.end();
        session = new ChatSession(undefined, { persona: opts?.persona });
        session.onToolProgress = (detail) => {
          process.stderr.write(`${DIM}  ${CYAN}▸${RESET}${DIM} ${detail}${RESET}\n`);
        };
        turnNum = 0;
        console.log(`${DIM}Fresh session started.${RESET}\n`);
        promptUser();
        return;
      }

      // Send to Pi — stream tokens as they arrive
      answering = true;
      process.stderr.write(`${DIM}Thinking...${RESET}\n`);

      let streamStarted = false;
      session.onTextDelta = (delta) => {
        if (!streamStarted) {
          process.stdout.write("\n");
          streamStarted = true;
        }
        process.stdout.write(delta);
      };

      try {
        const result = await session.send(trimmed);

        // Ensure trailing newline after streamed output
        if (streamStarted && !result.answer.endsWith("\n")) {
          process.stdout.write("\n");
        }
        process.stdout.write("\n");
      } catch (err: any) {
        console.error(`\n${DIM}Error: ${err.message}${RESET}\n`);
      }

      answering = false;
      promptUser();
    });
  };

  // Handle Ctrl+C — only if we didn't already exit via /quit
  rl.on("close", async () => {
    if (!exited) {
      exited = true;
      const summary = await session.end();
      console.log(
        `\n${DIM}Session ended. ${summary.totalTurns} turn${summary.totalTurns !== 1 ? "s" : ""}.${RESET}`
      );
      process.exit(0);
    }
  });

  promptUser();
}
