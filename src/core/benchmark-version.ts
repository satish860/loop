import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { QAPair } from "./qa-generator.js";
import { CorpusManager } from "./corpus.js";
import { buildSystemPrompt } from "./session.js";
import { resolvePersona } from "./config.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";
const BENCHMARKS_DIR = join(HOME, ".loop", "benchmarks", "custom");

// ── Types ──

export interface BenchmarkVersion {
  version: string;           // "v1", "v2", ...
  timestamp: string;         // ISO date
  pairCount: number;
  corpusDocCount: number;
  systemPromptHash: string;  // sha256 of system prompt (first 12 chars)
  description?: string;      // optional note
}

export interface BenchmarkManifest {
  latest: string;            // "v3" — the current version
  versions: BenchmarkVersion[];
}

export interface VersionedBenchmark {
  version: string;
  pairs: QAPair[];
  meta: BenchmarkVersion;
}

// ── Manifest ──

const MANIFEST_FILE = "versions.json";

function manifestPath(): string {
  return join(BENCHMARKS_DIR, MANIFEST_FILE);
}

function loadManifest(): BenchmarkManifest {
  const p = manifestPath();
  if (!existsSync(p)) {
    return { latest: "", versions: [] };
  }
  return JSON.parse(readFileSync(p, "utf-8"));
}

function saveManifest(manifest: BenchmarkManifest): void {
  if (!existsSync(BENCHMARKS_DIR)) mkdirSync(BENCHMARKS_DIR, { recursive: true });
  writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

// ── Core ──

/** Hash the current system prompt (for tracking changes across versions) */
function getSystemPromptHash(): string {
  const persona = resolvePersona();
  const prompt = buildSystemPrompt(persona);
  return createHash("sha256").update(prompt).digest("hex").slice(0, 12);
}

/** Get the next version number */
function nextVersion(manifest: BenchmarkManifest): string {
  if (manifest.versions.length === 0) return "v1";
  const nums = manifest.versions.map((v) =>
    parseInt(v.version.replace("v", ""), 10)
  );
  return `v${Math.max(...nums) + 1}`;
}

/**
 * Save a set of QA pairs as a new benchmark version.
 *
 * Called after import (human review complete).
 * Creates qa-pairs-v{N}.jsonl and updates qa-pairs.jsonl (latest).
 */
export function saveBenchmarkVersion(
  pairs: QAPair[],
  description?: string
): BenchmarkVersion {
  if (!existsSync(BENCHMARKS_DIR)) mkdirSync(BENCHMARKS_DIR, { recursive: true });

  const manifest = loadManifest();
  const version = nextVersion(manifest);
  const corpus = new CorpusManager();

  const meta: BenchmarkVersion = {
    version,
    timestamp: new Date().toISOString(),
    pairCount: pairs.length,
    corpusDocCount: corpus.listDocuments().length,
    systemPromptHash: getSystemPromptHash(),
    description,
  };

  // Save versioned file
  const versionedPath = join(BENCHMARKS_DIR, `qa-pairs-${version}.jsonl`);
  writeFileSync(
    versionedPath,
    pairs.map((p) => JSON.stringify(p)).join("\n") + "\n",
    "utf-8"
  );

  // Update latest (qa-pairs.jsonl)
  const latestPath = join(BENCHMARKS_DIR, "qa-pairs.jsonl");
  copyFileSync(versionedPath, latestPath);

  // Update manifest
  manifest.latest = version;
  manifest.versions.push(meta);
  saveManifest(manifest);

  return meta;
}

/**
 * Load a benchmark by name and optional version.
 *
 * loadVersionedBenchmark()          → latest version
 * loadVersionedBenchmark("v1")      → specific version
 */
export function loadVersionedBenchmark(version?: string): VersionedBenchmark | null {
  const manifest = loadManifest();

  if (manifest.versions.length === 0) return null;

  const targetVersion = version ?? manifest.latest;
  const meta = manifest.versions.find((v) => v.version === targetVersion);

  if (!meta) return null;

  const filePath = join(BENCHMARKS_DIR, `qa-pairs-${targetVersion}.jsonl`);
  if (!existsSync(filePath)) return null;

  const lines = readFileSync(filePath, "utf-8").trim().split("\n");
  const pairs: QAPair[] = lines.filter((l) => l.trim()).map((l) => JSON.parse(l));

  return { version: targetVersion, pairs, meta };
}

/** List all benchmark versions */
export function listBenchmarkVersions(): BenchmarkVersion[] {
  return loadManifest().versions;
}

/** Get the latest version string, or null if no benchmarks exist */
export function getLatestVersion(): string | null {
  const manifest = loadManifest();
  return manifest.latest || null;
}
