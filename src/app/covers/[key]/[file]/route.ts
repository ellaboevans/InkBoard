import { connection } from "next/server";
import { serveCover } from "@/server/photo-route";

/** A novel's uploaded cover, WebP (docs/PLAN.md, Phase 25): /covers/<key>/<128|256|512>.webp. */
export async function GET(_req: Request, { params }: RouteContext<"/covers/[key]/[file]">) {
  await connection(); // reads storage and the database on every request
  const { key, file } = await params;
  return serveCover(key, file);
}
