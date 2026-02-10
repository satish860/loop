import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import { rmSync } from "fs";
import { join } from "path";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const LOOP_DIR = join(HOME, ".loop");
const PDF = "dataset/BESTBUY_2023_10K.pdf";

describe("Story 1.8: loop query CLI", () => {
  beforeAll(() => {
    // Always re-ingest to avoid dependency on other tests' state
    execSync(`npx tsx src/index.ts ingest ${PDF}`, { encoding: "utf-8" });
  }, 30_000);

  it("streams an answer with citation for a factual question", async () => {
    const out = execSync(
      'npx tsx src/index.ts query "What state is Best Buy incorporated in?"',
      { encoding: "utf-8", timeout: 120_000 }
    );

    const lower = out.toLowerCase();
    expect(lower).toContain("minnesota");
    // Should have some form of citation
    expect(lower).toMatch(/bestbuy|10.?k|page/i);
  }, 120_000);

  it("exits 1 when no documents ingested", () => {
    try {
      execSync('npx tsx src/index.ts query "test"', {
        encoding: "utf-8",
        stdio: "pipe",
        env: {
          ...process.env,
          HOME: "/tmp/fake-loop-home",
          USERPROFILE: "/tmp/fake-loop-home",
        },
      });
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.status).not.toBe(0);
      expect(e.stderr.toString() + e.stdout.toString()).toContain(
        "No documents ingested"
      );
    }
  }, 10_000);
});
