/**
 * `pnpm content:hide <link>` / `pnpm content:restore <link>`: the site owner
 * hides a reported poem, novel or author from every reader, or brings it back
 * exactly as it was (docs/PLAN.md, Phase 32 round 2). Nothing is deleted.
 *
 * The link is the page's address as the report email shows it: /p/<author>/<poem>,
 * /a/<author>, /a/<author>/n/<novel>, /a/<author>/n/<novel>/<chapter> (hides the
 * whole novel), or a short link /s/…; a whole URL works too.
 *
 * It calls the owner-only POST /api/owner/takedown on the running site,
 * authorised with CRON_SECRET, because only the app can refresh its own cache.
 * The writer gets an email when something changes.
 *
 *   pnpm content:hide /p/ama-serwaa/harmattan      # APP_URL and CRON_SECRET from .env.local
 *   APP_URL=https://… CRON_SECRET=… pnpm content:restore /a/ama-serwaa
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

type Answer = {
  changed?: boolean;
  kind?: "poem" | "novel" | "author";
  title?: string;
  penName?: string;
  path?: string;
  viaChapter?: { title: string; slug: string };
  error?: string;
};

/** "poem “Dusk” by Ama (/p/ama/dusk)" */
function describe(a: Answer): string {
  if (a.kind === "author") return `author ${a.penName} (${a.path}) and everything of theirs`;
  if (a.kind === "novel") return `novel “${a.title}” by ${a.penName} (${a.path}) with every chapter`;
  return `poem “${a.title}” by ${a.penName} (${a.path})`;
}

async function main() {
  const action = process.argv[2];
  const link = (process.argv[3] ?? "").trim();
  const verb = action === "hide" ? "content:hide" : "content:restore";
  if ((action !== "hide" && action !== "restore") || !link) {
    console.error(`Usage: pnpm ${verb} <link>   (the page's address from the report email: /p/…, /a/…, /a/…/n/…, /a/…/n/…/<chapter> or /s/…)`);
    process.exit(2);
  }
  const site = process.env.APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!site || !secret) {
    console.error("Set APP_URL (the live site) and CRON_SECRET (as in Vercel) first.");
    process.exit(2);
  }
  const res = await fetch(new URL("/api/owner/takedown", site), {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ link, action }),
  });
  const json = (await res.json().catch(() => ({}))) as Answer;
  if (!res.ok) {
    console.error(`Failed (HTTP ${res.status}): ${json.error ?? "no details"}`);
    process.exit(1);
  }
  if (json.viaChapter) {
    const name = json.viaChapter.title.trim() || json.viaChapter.slug;
    console.log(`That's a chapter (“${name}”): a chapter can't be ${action === "hide" ? "hidden" : "restored"} on its own, so this acts on its novel.`);
  }
  const what = describe(json);
  if (action === "hide") {
    console.log(json.changed ? `Hidden: ${what}. Readers can't see it now; the writer has been emailed.` : `Already hidden: ${what}. Nothing changed.`);
  } else {
    console.log(json.changed ? `Restored: ${what}. Readers can see it again, exactly as it was; the writer has been emailed.` : `Not hidden: ${what}. Nothing changed.`);
  }
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
