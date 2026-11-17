import { connection } from "next/server";
import { servePhoto } from "@/server/photo-route";

/** A profile photo's WebP copy (docs/PLAN.md, Phase 22): /photos/<key>/<96|192|384>.webp. */
export async function GET(_req: Request, { params }: RouteContext<"/photos/[key]/[file]">) {
  await connection(); // reads storage and the database on every request
  const { key, file } = await params;
  return servePhoto(key, file);
}
