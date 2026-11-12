import "server-only";
import { renderAvatar, selectAvatar } from "@usenavii/core";
import { getAvatar } from "@/lib/avatars";

/** Paper tile behind each mascot (the --secondary token, as sRGB for SVG). */
const TILE = "#f3eee6";

/**
 * Render a curated avatar as a standalone SVG. Hue drift is turned off so the
 * set keeps the palettes we picked. Static (no animation), no background,
 * on a paper-coloured circle. Returns null for unknown ids.
 */
export function renderAvatarSvg(id: string): string | null {
  const def = getAvatar(id);
  if (!def) return null;
  const spec = selectAvatar(def.seed, { paletteId: def.paletteId, background: "none" });
  return renderAvatar({ ...spec, hueShift: 0 }, { size: 128, background: "none", tileBg: TILE });
}
