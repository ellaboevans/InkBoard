/**
 * `pnpm photo:remove <author-slug>`: the site owner takes an author's
 * profile photo down (abuse), without their account (docs/PLAN.md, Phase 22).
 *
 * It calls the owner-only POST /api/owner/photo-takedown on the running
 * site, authorised with CRON_SECRET, because only the app can refresh its
 * own cache: the photo's files are deleted, the avatar shows everywhere, and
 * every cached page and picture is refreshed at once.
 *
 *   pnpm photo:remove ama-serwaa                     # APP_URL and CRON_SECRET from .env.local
 *   APP_URL=https://… CRON_SECRET=… pnpm photo:remove ama-serwaa
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const author = (process.argv[2] ?? "").replace(/^.*\/a\//, "").replace(/\/.*$/, "").trim();
  if (!author) {
    console.error("Usage: pnpm photo:remove <author-slug>   (the part after /a/ in their author page's address)");
    process.exit(2);
  }
  const site = process.env.APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!site || !secret) {
    console.error("Set APP_URL (the live site) and CRON_SECRET (as in Vercel) first.");
    process.exit(2);
  }
  const res = await fetch(new URL("/api/owner/photo-takedown", site), {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ author }),
  });
  const json = (await res.json().catch(() => ({}))) as { removed?: boolean; error?: string };
  if (!res.ok) {
    console.error(`Failed (HTTP ${res.status}): ${json.error ?? "no details"}`);
    process.exit(1);
  }
  console.log(json.removed ? `Removed /a/${author}'s photo; their avatar shows everywhere now.` : `/a/${author} has no photo; nothing to do.`);
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
