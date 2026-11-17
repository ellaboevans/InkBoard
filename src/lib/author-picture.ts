import { avatarIdFor, avatarUrl, type AvatarId } from "./avatars";
import { PHOTO_WEBP_SIZES, type PhotoWebpSize } from "./photo-limits";

/**
 * "Photo or avatar" (docs/PLAN.md, Phase 22), decided here and nowhere else.
 * Every loader that shows an author turns its editor row into an
 * AuthorPicture with authorPicture(); the AuthorPicture component draws it in
 * the browser and pictureDataUri (src/server/author-picture.ts) for Satori.
 * Pure and client-safe: only ids and URLs, never bytes.
 */
export type AuthorPicture = {
  /** Always set: shown when there's no photo, and behind a photo as its fallback. */
  avatarId: AvatarId;
  /** The current photo's random key, or null. */
  photoKey: string | null;
};

export function authorPicture(editor: { id: string; avatar: string | null; photoKey: string | null }): AuthorPicture {
  return { avatarId: avatarIdFor(editor), photoKey: editor.photoKey };
}

export const photoUrl = (key: string, size: PhotoWebpSize) => `/photos/${key}/${size}.webp`;

/** The smallest copy at least `cssPx × 2` wide (a phone's density), as the plain `src`. */
export function photoSizeFor(cssPx: number): PhotoWebpSize {
  return PHOTO_WEBP_SIZES.find((s) => s >= cssPx * 2) ?? PHOTO_WEBP_SIZES[PHOTO_WEBP_SIZES.length - 1];
}

export type PictureSources =
  | { kind: "photo"; src: string; srcSet: string; fallback: string }
  | { kind: "avatar"; src: string };

export function pictureSources(picture: AuthorPicture, cssPx: number): PictureSources {
  const avatar = avatarUrl(picture.avatarId);
  if (!picture.photoKey) return { kind: "avatar", src: avatar };
  const key = picture.photoKey;
  return {
    kind: "photo",
    src: photoUrl(key, photoSizeFor(cssPx)),
    srcSet: PHOTO_WEBP_SIZES.map((s) => `${photoUrl(key, s)} ${s}w`).join(", "),
    fallback: avatar,
  };
}
