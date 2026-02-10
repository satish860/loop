import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000, // 2 min — real LLM calls take time
    teardownTimeout: 30_000,
    pool: "forks",
    poolOptions: {
      forks: {
        // Long-running LLM tests need generous IPC timeout
        execArgv: [],
      },
    },
    // Suppress vitest's internal RPC timeout for long-running test suites
    hookTimeout: 120_000,
  },
});
