import { existsSync } from "node:fs";
import { CorpusManager } from "./corpus.js";
import { createLoopSession } from "./session.js";
import { SessionLogger } from "./session-logger.js";
import { detectSignals, type Signal } from "./signal-detector.js";
import { resolvePersona, type Persona } from "./config.js";
import type { AgentSession } from "@mariozechner/pi-coding-agent";

export interface ChatTurn {
  turn: number;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface ChatSessionOptions {
  persona?: string;
  corpusDir?: string;
}

export interface SessionSummary {
  id: string;
  totalTurns: number;
  duration: number; // ms
  turns: ChatTurn[];
  signals: Signal[];
}

/**
 * ChatSession — programmatic multi-turn conversation with Pi.
 *
 * Testable core: tests call send() directly.
 * The `loop chat` CLI is a thin readline wrapper around this.
 */
export class ChatSession {
  private piSession: AgentSession | null = null;
  private _turns: ChatTurn[] = [];
  private _turnCount = 0;
  private _id: string;
  private _startTime: number;
  private _corpusDir: string;
  private _corpusDocCount: number;
  private _persona?: Persona;
  private _disposed = false;
  private _logger: SessionLogger;

  /** Callback for tool execution progress (optional, for CLI display) */
  onToolProgress?: (detail: string) => void;

  /** Callback for streaming text deltas (optional, for real-time CLI output) */
  onTextDelta?: (delta: string) => void;

  constructor(corpusDir?: string, opts?: ChatSessionOptions) {
    const corpus = new CorpusManager(corpusDir);

    if (!existsSync(corpus.dir)) {
      throw new Error("No documents ingested. Run `loop ingest <file>` first.");
    }

    const docs = corpus.listDocuments();
    if (docs.length === 0) {
      throw new Error("No documents ingested. Run `loop ingest <file>` first.");
    }

    this._corpusDir = corpus.dir;
    this._corpusDocCount = docs.length;
    this._persona = resolvePersona(opts?.persona);
    this._id = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this._startTime = Date.now();
    this._logger = new SessionLogger(this._id);
  }

  get id(): string {
    return this._id;
  }

  get persona(): Persona {
    return this._persona ?? "general";
  }

  get turns(): ChatTurn[] {
    return [...this._turns];
  }

  get turnCount(): number {
    return this._turnCount;
  }

  /**
   * Send a message and get Pi's response.
   * Session persists between calls — follow-ups maintain context.
   */
  async send(message: string): Promise<ChatTurn & { answer: string }> {
    if (this._disposed) {
      throw new Error("Session has ended. Create a new ChatSession.");
    }

    // Lazily create Pi session on first send
    if (!this.piSession) {
      this.piSession = await createLoopSession(this._corpusDir, {
        fresh: true,
        persona: this._persona,
      });
      this._setupToolProgress();
      this._logger.logStart({
        corpusDocs: this._corpusDocCount,
        persona: this._persona,
      });
    }

    this._turnCount++;

    // Log user turn
    const userTurn: ChatTurn = {
      turn: this._turnCount,
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    };
    this._turns.push(userTurn);
    this._logger.logTurn("user", message, this._turnCount);

    // Send to Pi and collect response (streaming via onTextDelta callback)
    let fullResponse = "";

    const unsubscribe = this.piSession.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        const delta = event.assistantMessageEvent.delta;
        fullResponse += delta;
        if (this.onTextDelta) this.onTextDelta(delta);
      }
    });

    await this.piSession.prompt(message);
    unsubscribe();

    // Log assistant turn
    const assistantTurn: ChatTurn = {
      turn: this._turnCount,
      role: "assistant",
      content: fullResponse,
      timestamp: new Date().toISOString(),
    };
    this._turns.push(assistantTurn);
    this._logger.logTurn("assistant", fullResponse, this._turnCount);

    return { ...assistantTurn, answer: fullResponse };
  }

  /**
   * End the chat session. Runs signal detection, disposes Pi session, returns summary.
   */
  async end(): Promise<SessionSummary> {
    const duration = Date.now() - this._startTime;

    // Run signal detection post-session (before logging session_end)
    let signals: Signal[] = [];
    if (this._turnCount > 0) {
      // Build entries from in-memory turns for detection
      const entries = this._turns.map((t) => ({
        type: "turn" as const,
        role: t.role,
        content: t.content,
        turn: t.turn,
      }));
      signals = detectSignals(entries);

      // Log each signal to the session file
      for (const sig of signals) {
        this._logger.logSignal(sig);
      }

      this._logger.logEnd(this._turnCount, duration);
    }

    if (this.piSession) {
      this.piSession.dispose();
      this.piSession = null;
    }
    this._disposed = true;

    return {
      id: this._id,
      totalTurns: this._turnCount,
      duration,
      turns: [...this._turns],
      signals,
    };
  }

  /** Path to the session log file */
  get logPath(): string {
    return this._logger.path;
  }

  /** Wire up tool progress events to the optional callback */
  private _setupToolProgress(): void {
    if (!this.piSession || !this.onToolProgress) return;

    this.piSession.subscribe((event) => {
      if (event.type === "tool_execution_start" && this.onToolProgress) {
        const name = event.toolName;
        const input = event.args;

        let detail = "";
        const n = name.toLowerCase();
        if (n === "read" && input?.path) {
          detail = `Reading ${input.path}`;
        } else if (n === "bash" && input?.command) {
          detail = `Running: ${input.command}`;
        } else if (n === "grep" && input?.pattern) {
          detail = `Searching for "${input.pattern}"`;
        } else if (n === "ls") {
          detail = `Listing ${input?.path || "."}`;
        } else {
          detail = name;
        }

        this.onToolProgress(detail);
      }
    });
  }
}
