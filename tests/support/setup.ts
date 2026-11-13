import { sql } from "drizzle-orm";
import { beforeEach, vi } from "vitest";
import { getDb } from "@/db";
import { alerts, outbox } from "./outbox";

// Capture outgoing emails instead of sending/logging them.
vi.mock("@/server/email", async () => {
  const { alerts, outbox } = await import("./outbox");
  return {
    sendOtpEmail: vi.fn(async (to: string, code: string, linkToken: string) => {
      outbox.push({ to, code, linkToken });
    }),
    sendSignInAlertEmail: vi.fn(async (to: string, d: { device: string; ip: string; penName: string | null; reason: string }) => {
      alerts.push({ to, device: d.device, ip: d.ip, penName: d.penName, reason: d.reason });
    }),
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
  await getDb().execute(
    sql`TRUNCATE editors, email_otps, sessions, poems, rate_limits CASCADE`,
  );
});
