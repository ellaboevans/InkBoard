import { connection } from "next/server";
import { env } from "@/env";
import { cleanupExpiredRows, isAuthorizedCron } from "@/server/maintenance";

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
  return Response.json({ ok: true, deleted });
}
