import { connection } from "next/server";
import { env } from "@/env";
import { cleanupExpiredRows, isAuthorizedCron } from "@/server/maintenance";
import { announceReleasedChapters } from "@/server/release-announcements";

/** Daily cleanup (vercel.json `crons`). Requires `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: Request) {
  await connection(); // never prerender: it deletes rows
  const { CRON_SECRET } = env();
  if (!CRON_SECRET) {
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (!isAuthorizedCron(request.headers.get("authorization"), CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const deleted = await cleanupExpiredRows();
  console.info("[cron] cleanup", deleted);
  // Scheduled chapters released since the last run: their "new chapter" notification (Phase 28).
  const released = await announceReleasedChapters();
  console.info("[cron] release announcements", released);
  return Response.json({ ok: true, deleted, released });
}
