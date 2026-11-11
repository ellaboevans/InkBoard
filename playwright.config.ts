import path from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = 3100;
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://localhost:5432/poemhub_e2e";
export const OTP_OUTBOX = path.resolve("test-results/otp-outbox.jsonl");

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Uses the locally installed Chrome; run `pnpm exec playwright install chromium` instead if absent.
    channel: process.env.PW_CHANNEL ?? "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm next dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      E2E_OTP_OUTBOX: OTP_OUTBOX,
      RESEND_API_KEY: "",
      EDITOR_ALLOWLIST: "",
    },
  },
});
