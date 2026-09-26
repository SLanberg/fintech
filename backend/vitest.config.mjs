import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Run in a single forked process to avoid SQLite WAL-mode file conflicts
    pool: "forks",
    singleFork: true,
  },
});
