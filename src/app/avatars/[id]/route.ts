import { AVATARS } from "@/lib/avatars";
import { renderAvatarSvg } from "@/server/avatar-svg";

/** All curated avatars are prerendered at build time. */
export function generateStaticParams() {
  return AVATARS.map((a) => ({ id: a.id }));
}

export async function GET(_req: Request, { params }: RouteContext<"/avatars/[id]">) {
  const { id } = await params;
  const svg = renderAvatarSvg(id);
  if (!svg) return new Response("Not found", { status: 404 });
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // The set is fixed per id (see src/lib/avatars.ts), so it can be cached forever.
      "Cache-Control": "public, max-age=31536000, immutable",
      // Belt and braces: if opened directly, the SVG document can't run anything.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
