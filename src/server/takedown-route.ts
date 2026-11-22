import "server-only";
import { env } from "@/env";
import { BOARD_TAG, poemTag } from "./cache-tags";
import { isAuthorizedCron } from "./maintenance";
import { applyTakedown, findTakedownTarget, parseTakedownLink, type TakedownGuard, type TakedownTarget } from "./takedown";

/** What the writer is told (src/server/email.ts sendTakedownEmail): never the report or anything about the reader. */
export type TakedownNotify = (
  to: string,
  change: "hidden" | "restored",
  details: { penName: string; kind: TakedownTarget["kind"]; title: string | null; at: Date },
) => Promise<void>;

export const TAKEDOWN_LINK_HELP =
  "Give the page's address as the report email shows it: /p/<author>/<poem>, /a/<author>, /a/<author>/n/<novel>, /a/<author>/n/<novel>/<chapter> or a short link /s/…";

export type TakedownOutcome =
  | { ok: false; error: "bad_action" | "bad_link" | "not_found" | "step_up_required" }
  | {
      ok: true;
      action: "hide" | "restore";
      /** False when it already was so: nothing written, nothing sent. */
      changed: boolean;
      kind: TakedownTarget["kind"];
      title: string;
      penName: string;
      path: string;
      viaChapter?: { title: string; slug: string };
    };

/**
 * The one takedown path (Phase 32 rounds 2 and 3), shared by the owner's
 * route (`pnpm content:hide|restore`) and the owner's page: read the link,
 * find what it names, hide or restore it (with `guard` inside the writing
 * transaction: the page's step-up), then refresh every cache and email the
 * writer when something changed. `revalidate` is the caller's: the route's
 * revalidateTag(tag, { expire: 0 }), the action's updateTag.
 */
export async function runTakedown(
  input: { link: unknown; action: unknown },
  deps: { revalidate: (tag: string) => void; notify: TakedownNotify; guard?: TakedownGuard },
): Promise<TakedownOutcome> {
  const { action } = input;
  if (action !== "hide" && action !== "restore") return { ok: false, error: "bad_action" };
  const link = parseTakedownLink(input.link);
  if (!link) return { ok: false, error: "bad_link" };
  const target = await findTakedownTarget(link);
  if (!target) return { ok: false, error: "not_found" };

  const res = await applyTakedown(target, action, { guard: deps.guard });
  if (!res.ok) return res;
  if (res.changed) {
    deps.revalidate(BOARD_TAG);
    if (target.kind === "poem") deps.revalidate(poemTag(target.id));
    try {
      await deps.notify(target.email, action === "hide" ? "hidden" : "restored", {
        penName: target.penName,
        kind: target.kind,
        title: target.kind === "author" ? null : target.title,
        at: res.at,
      });
    } catch {
      // The takedown stands; never log the address.
      console.error("[owner] takedown email failed");
    }
  }
  console.info("[owner] takedown", { action, kind: target.kind, path: target.path, changed: res.changed });
  return {
    ok: true,
    action,
    changed: res.changed,
    kind: target.kind,
    title: target.title,
    penName: target.penName,
    path: target.path,
    ...(target.viaChapter ? { viaChapter: target.viaChapter } : {}),
  };
}

/**
 * The owner's takedown route (docs/PLAN.md, Phase 32 round 2), framework-free; the
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
  const out = await runTakedown({ link: body?.link, action: body?.action }, { revalidate: (tag) => revalidate(tag, { expire: 0 }), notify });
  if (!out.ok) {
    if (out.error === "bad_action") return Response.json({ error: 'action must be "hide" or "restore"' }, { status: 400 });
    if (out.error === "bad_link") return Response.json({ error: `Can't read that link. ${TAKEDOWN_LINK_HELP}` }, { status: 400 });
    return Response.json({ error: "Nothing there: no poem, novel, chapter or author at that link." }, { status: 404 });
  }
  const { action, changed, kind, title, penName, path, viaChapter } = out;
  return Response.json({
    ok: true,
    action,
    changed,
    kind,
    title,
    penName,
    path,
    hidden: action === "hide",
    ...(viaChapter ? { viaChapter } : {}),
  });
}
