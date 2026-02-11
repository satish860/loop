import * as readline from "node:readline";
import {
  appendAnnotation,
  createAnnotation,
  type ErrorType,
} from "./annotations.js";

const ERROR_TYPES: Record<string, ErrorType> = {
  "1": "wrong_value",
  "2": "incomplete",
  "3": "wrong_source",
  "4": "hallucinated",
  "5": "other",
};

const ERROR_LABELS: Record<ErrorType, string> = {
  wrong_value: "wrong value",
  incomplete: "incomplete",
  wrong_source: "wrong source",
  hallucinated: "hallucinated",
  other: "other",
};

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

/**
 * Prompt the user for feedback after a query answer.
 * Returns the label or null if skipped.
 */
export async function captureFeedback(
  query: string,
  answer: string
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const labelInput = await ask(rl, "\n[p]ass / [f]ail / [s]kip: ");
    const key = labelInput.trim().toLowerCase();

    if (key === "p") {
      const annotation = createAnnotation(query, answer, "pass");
      appendAnnotation(annotation);
      console.error("✅ Pass");
      return;
    }

    if (key === "s" || key === "") {
      const annotation = createAnnotation(query, answer, "skip");
      appendAnnotation(annotation);
      console.error("⏭️  Skipped");
      return;
    }

    if (key === "f") {
      // Capture correction
      const correction = await ask(rl, "What's the correct answer? ");

      // Capture error type
      const typeInput = await ask(
        rl,
        "[1] wrong value  [2] incomplete  [3] wrong source  [4] hallucinated  [5] other: "
      );
      const errorType = ERROR_TYPES[typeInput.trim()] ?? "other";

      const annotation = createAnnotation(query, answer, "fail", {
        correction: correction.trim() || undefined,
        errorType,
      });
      appendAnnotation(annotation);
      console.error(`❌ Fail — ${ERROR_LABELS[errorType]}. Correction saved.`);
      return;
    }

    // Unrecognized input — skip
    console.error("⏭️  Skipped (unrecognized input)");
    const annotation = createAnnotation(query, answer, "skip");
    appendAnnotation(annotation);
  } finally {
    rl.close();
  }
}
