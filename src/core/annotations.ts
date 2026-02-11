import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export type ErrorType =
  | "wrong_value"
  | "incomplete"
  | "wrong_source"
  | "hallucinated"
  | "other";

export interface Annotation {
  id: string;
  timestamp: string;
  query: string;
  answer: string;
  label: "pass" | "fail" | "skip";
  correction: string | null;
  note: string | null;
  errorType: ErrorType | null;
}

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const DEFAULT_PATH = join(HOME, ".loop", "annotations.jsonl");

export function getAnnotationsPath(): string {
  return DEFAULT_PATH;
}

export function appendAnnotation(annotation: Annotation, path?: string): void {
  const filepath = path ?? DEFAULT_PATH;
  const dir = dirname(filepath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const line = JSON.stringify(annotation) + "\n";
  appendFileSync(filepath, line, "utf-8");
}

export function loadAnnotations(path?: string): Annotation[] {
  const filepath = path ?? DEFAULT_PATH;
  if (!existsSync(filepath)) return [];

  return readFileSync(filepath, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

export function createAnnotation(
  query: string,
  answer: string,
  label: "pass" | "fail" | "skip",
  opts?: { correction?: string; note?: string; errorType?: ErrorType }
): Annotation {
  return {
    id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    query,
    answer,
    label,
    correction: opts?.correction ?? null,
    note: opts?.note ?? null,
    errorType: opts?.errorType ?? null,
  };
}
