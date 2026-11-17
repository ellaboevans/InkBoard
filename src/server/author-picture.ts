import "server-only";
import type { AuthorPicture } from "@/lib/author-picture";
import { renderAvatarSvg } from "./avatar-svg";
import { readPhotoJpeg } from "./profile-photos";

/**
 * The author's picture as a data URI for Satori (share image, link cards):
 * the photo's JPEG copy read straight from storage (Satori can't read WebP,
 * and a render never fetches our own URL), else the avatar's SVG. A photo
 * that can't be read falls back to the avatar, so a picture never fails.
 */
export async function pictureDataUri(picture: AuthorPicture): Promise<string | null> {
  if (picture.photoKey) {
    const jpeg = await readPhotoJpeg(picture.photoKey);
    if (jpeg) return `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`;
  }
  const svg = renderAvatarSvg(picture.avatarId);
  return svg ? `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` : null;
}
