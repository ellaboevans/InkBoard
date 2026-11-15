import { defineConfig } from "@playwright/test";
import { OFFLINE_BASE_URL } from "./e2e-offline/constants";

/**
 * Offline reading E2E, against a production build (the service worker is
 * production-only). globalSetup writes fixtures into OFFLINE_E2E_DATABASE_URL,
 * runs `next build` into .next-offline and `next start` on OFFLINE_E2E_PORT;
 * the deploy test rebuilds and restarts it. Run with:
 *
 *   OFFLINE_E2E_DATABASE_URL=postgresql://localhost:5432/poemhub_e2e_<name> OFFLINE_E2E_PORT=3177 \
 *     pnpm exec playwright test -c playwright.offline.config.ts
 */
export default defineConfig({
  testDir: "./e2e-offline",
  globalSetup: "./e2e-offline/global-setup.ts",
  globalTeardown: "./e2e-offline/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The deploy test runs a whole `next build`.
  timeout: 360_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: OFFLINE_BASE_URL,
    channel: process.env.PW_CHANNEL ?? "chrome",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
  },
});
