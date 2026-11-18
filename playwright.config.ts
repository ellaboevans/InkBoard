import path from "node:path";
import { defineConfig } from "@playwright/test";
import webpush from "web-push";

const PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_BASE_URL = `http://localhost:${PORT}`;
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://localhost:5432/poemhub_e2e";
export const OTP_OUTBOX = path.resolve("test-results/otp-outbox.jsonl");
/** What the server would have pushed (src/server/push.ts): E2E never reaches a real push service. */
export const PUSH_OUTBOX = path.resolve("test-results/push-outbox.jsonl");
// Profile photos (Phase 22): the local storage driver, in this run's own folder.
export const E2E_PHOTO_DIR = path.resolve(".storage/e2e");
// Notifications (Phase 18): a throwaway VAPID key pair per run, never in git.
const vapid = webpush.generateVAPIDKeys();

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  // Tests run against `next dev`; a hot reload triggered by an unrelated file
  // change mid-save can remount the editor. One retry absorbs that; such
  // tests are still reported as "flaky", so real flakiness stays visible.
  retries: 1,
  // `next dev` compiles each route on first visit, which can take several
  // seconds on a busy machine; the defaults (5s / 30s) are too tight.
  // Routes are warmed up in globalSetup, but Server Actions can't be: each
  // one compiles on its first call (10–30 s on a busy machine).
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Uses the locally installed Chrome; run `pnpm exec playwright install chromium` instead if absent.
    channel: process.env.PW_CHANNEL ?? "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm next dev --port ${PORT}`,
    // Readiness probe must not touch the DB: Playwright starts the server
    // *before* globalSetup runs the migrations.
    url: `http://localhost:${PORT}/sign-in`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      // Passkeys accept exactly this origin (src/server/auth/webauthn-config.ts).
      APP_URL: E2E_BASE_URL,
      NEXT_DIST_DIR: ".next-e2e",
      E2E_OTP_OUTBOX: OTP_OUTBOX,
      E2E_PUSH_OUTBOX: PUSH_OUTBOX,
      RESEND_API_KEY: "",
      EDITOR_ALLOWLIST: "",
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      // localhost can't be the subject (Apple rejects it); nothing is sent to a push service in E2E.
      VAPID_SUBJECT: "mailto:e2e@inkboard.app",
      PHOTO_STORAGE_DIR: E2E_PHOTO_DIR,
      R2_ACCOUNT_ID: "",
      R2_ACCESS_KEY_ID: "",
      R2_SECRET_ACCESS_KEY: "",
      R2_BUCKET: "",
    },
  },
});
