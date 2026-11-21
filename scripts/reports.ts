/**
 * `pnpm reports`: readers' reports from the last 30 days, newest first, with
 * their links (docs/PLAN.md, Phase 32), straight from DATABASE_URL, for
 * when the report emails aren't at hand (or went past the daily cap).
 *
 *   pnpm reports                          # DATABASE_URL and APP_URL from .env.local
 *   DATABASE_URL=postgres://… pnpm reports
 *
 * Runs under `--conditions=react-server` so `server-only` imports resolve.
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { reportReasonLabel, isReportReason } from "@/lib/report";
import { recentReports } from "@/server/reports";

config({ path: [".env.local", ".env"], quiet: true });

const DAYS = 30;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_URL first (or put it in .env.local).");
    process.exit(2);
  }
  const site = process.env.APP_URL ?? "";
  const pool = new pg.Pool({ connectionString: url });
  try {
    const rows = await recentReports(DAYS, drizzle(pool));
    if (rows.length === 0) {
      console.log(`No reports in the last ${DAYS} days.`);
      return;
    }
    console.log(`${rows.length} report${rows.length === 1 ? "" : "s"} in the last ${DAYS} days, newest first:\n`);
    for (const r of rows) {
      const at = new Date(r.at).toISOString().replace("T", " ").slice(0, 16) + " UTC";
      const reason = isReportReason(r.reason) ? reportReasonLabel(r.reason) : r.reason;
      const what = r.kind === "author" ? `author ${r.penName}` : `${r.kind} “${r.title}” by ${r.penName}`;
      console.log(`${at}  ${reason}`);
      console.log(`  ${what}`);
      console.log(`  ${site ? new URL(r.path, site).href : r.path}`);
      if (r.details) console.log(`  ${r.details.replace(/\n/g, "\n  ")}`);
      console.log("");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
