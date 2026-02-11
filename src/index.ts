#!/usr/bin/env node

import { Command } from "commander";
import { ingest } from "./commands/ingest.js";
import { query } from "./commands/query.js";
import { chat } from "./commands/chat.js";
import { status } from "./commands/status.js";
import { configShow, configSet } from "./commands/config.js";
import { generateQACommand } from "./commands/generate-qa.js";
import { evalCommand } from "./commands/eval.js";

const program = new Command();

program
  .name("loop")
  .description("AI that learns from every correction — document intelligence CLI")
  .version("0.1.0");

program
  .command("ingest <source>")
  .description("Parse and ingest documents (PDF, Excel, CSV) or a folder")
  .action(async (source: string) => {
    await ingest(source);
  });

program
  .command("query <question>")
  .description("Ask a question about ingested documents (one-shot, for scripting)")
  .option("-j, --json", "Output structured JSON (for piping)")
  .option("-f, --feedback", "Prompt for pass/fail feedback after answer")
  .option("-n, --new", "Start a fresh session (ignore previous context)")
  .option("-o, --output <format>", "Save answer to file (md, json, csv)")
  .option("-p, --persona <type>", "Override persona for this query")
  .action(async (question: string, options: { json?: boolean; feedback?: boolean; new?: boolean; output?: string; persona?: string }) => {
    await query(question, { json: options.json, feedback: options.feedback, new: options.new, output: options.output, persona: options.persona });
  });

program
  .command("chat")
  .description("Interactive multi-turn conversation about your documents")
  .option("-p, --persona <type>", "Answer style (finance, legal, technical, executive, junior, portfolio_manager)")
  .action(async (options: { persona?: string }) => {
    await chat({ persona: options.persona });
  });

program
  .command("generate-qa")
  .description("Generate QA benchmark pairs from corpus documents")
  .option("-c, --count <number>", "Number of QA pairs to generate (default: 50)")
  .option("-e, --export <format>", "Export draft pairs for review (csv)")
  .option("-i, --import <file>", "Import reviewed CSV as validated benchmark")
  .action(async (options: { count?: string; export?: string; import?: string }) => {
    await generateQACommand(options);
  });

program
  .command("eval")
  .description("Run benchmark eval, grade answers, show accuracy")
  .option("-b, --benchmark <name>", "Benchmark to run (e.g., custom, custom@v1)")
  .option("-l, --limit <number>", "Max pairs to evaluate (cost control)")
  .action(async (options: { benchmark?: string; limit?: string }) => {
    await evalCommand({ benchmark: options.benchmark, limit: options.limit });
  });

program
  .command("demo")
  .description("Download FinanceBench and start interactive demo")
  .action(() => {
    console.log("TODO: demo");
  });

program
  .command("status")
  .description("Show corpus stats and annotation counts")
  .action(async () => {
    await status();
  });

const configCmd = program
  .command("config")
  .description("View and modify configuration");

configCmd
  .command("show")
  .description("Show current configuration")
  .action(async () => {
    await configShow();
  });

configCmd
  .command("set <key> <value>")
  .description("Set a config value (persona, model, api-key)")
  .action(async (key: string, value: string) => {
    await configSet(key, value);
  });

// `loop config` with no subcommand → show
configCmd.action(async () => {
  await configShow();
});

program.parse();
