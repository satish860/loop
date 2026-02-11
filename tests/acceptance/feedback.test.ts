import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { rmSync, readFileSync, existsSync } from "fs";
import {
  appendAnnotation,
  loadAnnotations,
  createAnnotation,
} from "../../src/core/annotations.js";

const TEST_PATH = "tmp/test-annotations.jsonl";

describe("Story 3.3: Annotation storage (JSONL)", () => {
  beforeEach(() => {
    if (existsSync(TEST_PATH)) rmSync(TEST_PATH);
  });
  afterAll(() => {
    rmSync("tmp", { recursive: true, force: true });
  });

  it("creates annotation file on first write", () => {
    appendAnnotation(createAnnotation("What is the lease term?", "12 years", "pass"), TEST_PATH);
    expect(existsSync(TEST_PATH)).toBe(true);
  });

  it("stores pass annotation with null correction", () => {
    appendAnnotation(createAnnotation("What is the lease term?", "12 years", "pass"), TEST_PATH);

    const loaded = loadAnnotations(TEST_PATH);
    expect(loaded.length).toBe(1);
    expect(loaded[0].label).toBe("pass");
    expect(loaded[0].query).toBe("What is the lease term?");
    expect(loaded[0].answer).toBe("12 years");
    expect(loaded[0].correction).toBeNull();
    expect(loaded[0].note).toBeNull();
    expect(loaded[0].errorType).toBeNull();
  });

  it("stores fail annotation with correction and error type", () => {
    appendAnnotation(
      createAnnotation("What is the engine reserve?", "$350/FH", "fail", {
        correction: "$420/FH per Amendment No. 1",
        errorType: "wrong_value",
      }),
      TEST_PATH
    );

    const loaded = loadAnnotations(TEST_PATH);
    expect(loaded.length).toBe(1);
    expect(loaded[0].label).toBe("fail");
    expect(loaded[0].correction).toBe("$420/FH per Amendment No. 1");
    expect(loaded[0].errorType).toBe("wrong_value");
  });

  it("appends multiple annotations (append-only)", () => {
    appendAnnotation(createAnnotation("Q1", "A1", "pass"), TEST_PATH);
    appendAnnotation(
      createAnnotation("Q2", "A2", "fail", { correction: "correct answer", errorType: "wrong_value" }),
      TEST_PATH
    );
    appendAnnotation(createAnnotation("Q3", "A3", "skip"), TEST_PATH);

    const loaded = loadAnnotations(TEST_PATH);
    expect(loaded.length).toBe(3);
    expect(loaded[0].label).toBe("pass");
    expect(loaded[1].label).toBe("fail");
    expect(loaded[2].label).toBe("skip");
  });

  it("each line is valid JSON (JSONL format)", () => {
    appendAnnotation(createAnnotation("Q1", "A1", "pass"), TEST_PATH);
    appendAnnotation(
      createAnnotation("Q2", "A2", "fail", { correction: "right", errorType: "incomplete" }),
      TEST_PATH
    );

    const raw = readFileSync(TEST_PATH, "utf-8").trim();
    const lines = raw.split("\n");
    expect(lines.length).toBe(2);

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("has id and timestamp on every annotation", () => {
    appendAnnotation(createAnnotation("Q1", "A1", "pass"), TEST_PATH);

    const loaded = loadAnnotations(TEST_PATH);
    expect(loaded[0].id).toMatch(/^a_/);
    expect(loaded[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns empty array when no annotations file", () => {
    const loaded = loadAnnotations(TEST_PATH);
    expect(loaded).toEqual([]);
  });
});
