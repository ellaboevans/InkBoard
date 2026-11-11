import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside a React Server environment.
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    setupFiles: ["tests/support/setup.ts"],
    // Tests share one database; run files serially.
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://localhost:5432/poemhub_test",
      AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
      EDITOR_ALLOWLIST: "",
      RESEND_API_KEY: "",
    },
  },
});
