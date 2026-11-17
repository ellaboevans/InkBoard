import "server-only";
import { env } from "@/env";
import { BOARD_TAG } from "./cache-tags";
import { isAuthorizedCron } from "./maintenance";
import { takeDownPhoto } from "./profile-photos";

/**
 * The owner's photo takedown (docs/PLAN.md, Phase 22), framework-free; the
 * route (src/app/api/owner/photo-takedown) passes Next's revalidateTag in.
 * Owner-only: `Authorization: Bearer $CRON_SECRET`, the server-to-server
 * secret the owner already holds; no editor session can reach it. Deletes the
 * photo's files and refreshes every cached page and picture at once
 * (expire: 0), so the avatar shows everywhere on the next request.
 */
export async function handlePhotoTakedown(
  request: Request,
  revalidate: (tag: string, profile: { expire: number }) => void,
): Promise<Response> {
  const { CRON_SECRET } = env();
  if (!CRON_SECRET) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!isAuthorizedCron(request.headers.get("authorization"), CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { author?: unknown } | null;
  const author = typeof body?.author === "string" ? body.author.trim().toLowerCase() : "";
  if (!/^[a-z0-9-]{1,80}$/.test(author)) return Response.json({ error: "Give the author's slug, as in /a/<slug>" }, { status: 400 });
  const res = await takeDownPhoto(author);
  if (!res) return Response.json({ error: `No author /a/${author}` }, { status: 404 });
  if (res.removed) revalidate(BOARD_TAG, { expire: 0 });
  console.info("[owner] photo takedown", { author, removed: res.removed });
  return Response.json({ ok: true, removed: res.removed });
}
