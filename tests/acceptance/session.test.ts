import { describe, it, expect, beforeAll, afterAll } from "vitest";
const IS_CI = !!process.env.CI;
import { rmSync, mkdirSync, existsSync } from "fs";
import { parsePdf } from "../../src/parsers/pdf.js";
import { CorpusManager } from "../../src/core/corpus.js";
import { createLoopSession } from "../../src/core/session.js";

const TEST_CORPUS = "fixtures/test-session-corpus";
const PDF = "fixtures/BESTBUY_2023_10K.pdf";

describe("Story 1.7: Pi session with system prompt", () => {
  beforeAll(async () => {
    rmSync(TEST_CORPUS, { recursive: true, force: true });
    mkdirSync(TEST_CORPUS, { recursive: true });

    // Ingest the PDF
    const corpus = new CorpusManager(TEST_CORPUS);
    const result = await parsePdf(PDF, `${TEST_CORPUS}/_tmp_parsed.txt`);
    corpus.addDocument(result);
  }, 30_000);

  afterAll(() => {
    rmSync(TEST_CORPUS, { recursive: true, force: true });
  });

  it.skipIf(IS_CI)("creates a session that can read INDEX.md", async () => {
    const session = createLoopSession(TEST_CORPUS);

    let response = "";
    (await session).subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        response += event.assistantMessageEvent.delta;
      }
    });

    await (await session).prompt(
      "List the documents available. Read INDEX.md first."
    );

    expect(response.toLowerCase()).toContain("bestbuy");
    (await session).dispose();
  }, 60_000);

  it("answers a question about Best Buy with citation", async () => {
    const session = await createLoopSession(TEST_CORPUS);

    let response = "";
    session.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        response += event.assistantMessageEvent.delta;
      }
    });

    await session.prompt(
      "What state is Best Buy incorporated in? Cite the source."
    );

    const lower = response.toLowerCase();
    // Best Buy is incorporated in Minnesota — this is on page 1 of the 10-K
    expect(lower).toContain("minnesota");
    // Should cite the file
    expect(lower).toMatch(/bestbuy|10.?k/i);

    session.dispose();
  }, 120_000);
}, 180_000);
