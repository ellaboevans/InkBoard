/**
 * The curated avatar set editors choose from (Navii mascots, rendered on our
 * own server by src/server/avatar-svg.ts and served from /avatars/<id>).
 * Pure and client-safe: no Navii import here.
 *
 * Each id maps to a fixed seed + palette, so the set never changes between
 * releases. Never reorder or remove entries: ids are stored in
 * editors.avatar. Append new ones at the end.
 */
const PALETTES = [
  "terracotta", "sand", "plum", "forest", "slate", "navy",
  "charcoal", "coral", "peach", "rose", "lavender", "teal",
] as const;

export type AvatarId = `a${string}`;
export type AvatarDef = { id: AvatarId; seed: string; paletteId: (typeof PALETTES)[number] };

export const AVATARS: readonly AvatarDef[] = Array.from({ length: 36 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return { id: `a${n}`, seed: `poemhub-avatar-${n}`, paletteId: PALETTES[i % PALETTES.length] };
});

const BY_ID = new Map<string, AvatarDef>(AVATARS.map((a) => [a.id, a]));

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === "string" && BY_ID.has(value);
}

export function getAvatar(id: string): AvatarDef | undefined {
  return BY_ID.get(id);
}

/** Editors who haven't picked one get a stable default derived from their id. */
export function defaultAvatarId(editorId: string): AvatarId {
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < editorId.length; i++) {
    h ^= editorId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return AVATARS[(h >>> 0) % AVATARS.length].id;
}

export function avatarIdFor(editor: { id: string; avatar: string | null }): AvatarId {
  return isAvatarId(editor.avatar) ? editor.avatar : defaultAvatarId(editor.id);
}

export const avatarUrl = (id: AvatarId) => `/avatars/${id}`;
