#!/usr/bin/env node

import { Command } from "commander";
import { ingest } from "./commands/ingest.js";
import { query } from "./commands/query.js";

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
  .description("Ask a question about ingested documents")
  .action(async (question: string) => {
    await query(question);
  });

program
  .command("eval")
  .description("Review answers, detect patterns, run judge, improve")
  .action(() => {
    console.log("TODO: eval");
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
  .action(() => {
    console.log("TODO: status");
  });

program
  .command("config")
  .description("View and modify configuration")
  .action(() => {
    console.log("TODO: config");
  });

program.parse();
