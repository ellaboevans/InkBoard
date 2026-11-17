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
      // Profile photos (Phase 22): the local driver, in a folder of the test
      // run's own; never R2, even if the shell has its variables set.
      PHOTO_STORAGE_DIR: path.resolve(import.meta.dirname, ".storage/test"),
      R2_ACCOUNT_ID: "",
      R2_ACCESS_KEY_ID: "",
      R2_SECRET_ACCESS_KEY: "",
      R2_BUCKET: "",
    },
  },
});
