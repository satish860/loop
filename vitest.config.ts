import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 300_000, // 5 min — OpenRouter/Kimi K2.5 can be slow
    teardownTimeout: 60_000,
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: [],
        // Tests run in parallel forks by default
      },
    },
    hookTimeout: 300_000,
  },
});
