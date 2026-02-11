import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 300_000, // 5 min — OpenRouter/Kimi K2.5 can be slow
    teardownTimeout: 60_000,
    pool: "forks",
    fileParallelism: false, // Tests share ~/.loop/ — must run sequentially
    hookTimeout: 300_000,
    poolOptions: {
      forks: {
        // Prevent vitest worker RPC "onTaskUpdate" timeout on slow CI
        drainTimeout: 300_000,
      },
    },
    dangerouslyIgnoreUnhandledErrors: true, // vitest RPC timeouts are not real failures
  },
});
