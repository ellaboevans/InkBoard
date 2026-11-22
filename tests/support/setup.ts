import { rm } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { beforeEach, vi } from "vitest";
import { getDb } from "@/db";
import { alerts, deletionNotices, outbox, passkeyNotices, recoveryNotices, reportNotices, stepUpCodes, takedownNotices, welcomes } from "./outbox";

// Capture outgoing emails instead of sending/logging them.
vi.mock("@/server/email", async () => {
  const { alerts, deletionNotices, outbox, passkeyNotices, recoveryNotices, reportNotices, stepUpCodes, takedownNotices, welcomes } =
    await import("./outbox");
  return {
    sendOtpEmail: vi.fn(async (to: string, code: string, linkToken: string) => {
      outbox.push({ to, code, linkToken });
    }),
    sendSignInAlertEmail: vi.fn(async (to: string, d: { device: string; ip: string; penName: string | null; reason: string }) => {
      alerts.push({ to, device: d.device, ip: d.ip, penName: d.penName, reason: d.reason });
    }),
    sendWelcomeEmail: vi.fn(async (to: string, d: { penName: string; slug: string }) => {
      welcomes.push({ to, penName: d.penName, slug: d.slug });
    }),
    sendRecoveryCodeUsedEmail: vi.fn(
      async (to: string, d: { device: string; remaining: number; at: Date; penName: string | null }) => {
        recoveryNotices.push({ to, kind: "used", ...d });
      },
    ),
    sendRecoveryCodesChangedEmail: vi.fn(
      async (to: string, d: { device: string; firstSet: boolean; at: Date; penName: string | null }) => {
        recoveryNotices.push({ to, kind: "changed", ...d });
      },
    ),
    sendStepUpEmail: vi.fn(async (to: string, code: string) => {
      stepUpCodes.push({ to, code });
    }),
    sendPasskeyAddedEmail: vi.fn(
      async (
        to: string,
        d: { passkeyName: string; device: string; afterRecovery: boolean; at: Date; penName: string | null },
      ) => {
        passkeyNotices.push({ to, kind: "added", ...d });
      },
    ),
    sendAccountDeletedEmail: vi.fn(async (to: string, d: { penName: string | null; device: string; at: Date }) => {
      deletionNotices.push({ to, ...d });
    }),
    sendTakedownEmail: vi.fn(
      async (
        to: string,
        change: "hidden" | "restored",
        d: { penName: string | null; kind: "poem" | "novel" | "author"; title: string | null; at: Date },
      ) => {
        takedownNotices.push({ to, change, ...d });
      },
    ),
    sendReportEmail: vi.fn(async (notice: import("@/server/reports").ReportNotice) => {
      reportNotices.push(notice);
    }),
    sendPasskeyRemovedEmail: vi.fn(
      async (to: string, d: { passkeyName: string; device: string; at: Date; penName: string | null }) => {
        passkeyNotices.push({ to, kind: "removed", ...d });
      },
    ),
  };
});

// `after()` needs a Next request scope; in tests run the task immediately.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    void task();
  },
}));

beforeEach(async () => {
  outbox.length = 0;
  alerts.length = 0;
  welcomes.length = 0;
  recoveryNotices.length = 0;
  stepUpCodes.length = 0;
  passkeyNotices.length = 0;
  deletionNotices.length = 0;
  reportNotices.length = 0;
  takedownNotices.length = 0;
  await getDb().execute(
    sql`TRUNCATE editors, email_otps, sessions, poems, rate_limits, retired_slugs, retired_short_codes, push_subscriptions CASCADE`,
  );
  // Profile photos' local storage (PHOTO_STORAGE_DIR, vitest.config.mts), like the tables.
  await rm(process.env.PHOTO_STORAGE_DIR!, { recursive: true, force: true });
});
