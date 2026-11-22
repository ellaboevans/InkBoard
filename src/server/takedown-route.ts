import "server-only";
import { env } from "@/env";
import { BOARD_TAG, poemTag } from "./cache-tags";
import { isAuthorizedCron } from "./maintenance";
import { applyTakedown, findTakedownTarget, parseTakedownLink, type TakedownTarget } from "./takedown";

/** What the writer is told (src/server/email.ts sendTakedownEmail): never the report or anything about the reader. */
export type TakedownNotify = (
  to: string,
  change: "hidden" | "restored",
  details: { penName: string; kind: TakedownTarget["kind"]; title: string | null; at: Date },
) => Promise<void>;

export const TAKEDOWN_LINK_HELP =
  "Give the page's address as the report email shows it: /p/<author>/<poem>, /a/<author>, /a/<author>/n/<novel>, /a/<author>/n/<novel>/<chapter> or a short link /s/…";

/**
 * The owner's takedown (docs/PLAN.md, Phase 32 round 2), framework-free; the
 * route (src/app/api/owner/takedown) passes Next's revalidateTag and the
 * writer's email in. Owner-only: `Authorization: Bearer $CRON_SECRET`, like
 * the photo takedown; no editor session can reach it.
 *
 * Body: `{ link, action: "hide" | "restore" }`. 401 without the secret, 400
 * for an action or link it can't read, 404 for nothing there, else 200 with
 * what it named and whether anything changed. A change refreshes every cached
 * page, feed and picture at once (expire: 0) and emails the writer.
 */
export async function handleTakedown(
  request: Request,
  revalidate: (tag: string, profile: { expire: number }) => void,
  notify: TakedownNotify,
): Promise<Response> {
  const { CRON_SECRET } = env();
  if (!CRON_SECRET) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!isAuthorizedCron(request.headers.get("authorization"), CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { link?: unknown; action?: unknown } | null;
  const action = body?.action;
  if (action !== "hide" && action !== "restore") return Response.json({ error: 'action must be "hide" or "restore"' }, { status: 400 });
  const link = parseTakedownLink(body?.link);
  if (!link) return Response.json({ error: `Can't read that link. ${TAKEDOWN_LINK_HELP}` }, { status: 400 });
  const target = await findTakedownTarget(link);
  if (!target) return Response.json({ error: "Nothing there: no poem, novel, chapter or author at that link." }, { status: 404 });

  const { changed, at } = await applyTakedown(target, action);
  if (changed) {
    revalidate(BOARD_TAG, { expire: 0 });
    if (target.kind === "poem") revalidate(poemTag(target.id), { expire: 0 });
    try {
      await notify(target.email, action === "hide" ? "hidden" : "restored", {
        penName: target.penName,
        kind: target.kind,
        title: target.kind === "author" ? null : target.title,
        at,
      });
    } catch {
      // The takedown stands; never log the address.
      console.error("[owner] takedown email failed");
    }
  }
  console.info("[owner] takedown", { action, kind: target.kind, path: target.path, changed });
  return Response.json({
    ok: true,
    action,
    changed,
    kind: target.kind,
    title: target.title,
    penName: target.penName,
    path: target.path,
    hidden: action === "hide",
    ...(target.viaChapter ? { viaChapter: target.viaChapter } : {}),
  });
}
