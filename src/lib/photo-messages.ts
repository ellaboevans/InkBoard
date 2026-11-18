import { formatMegabytes, PHOTO_MAX_BYTES, PHOTO_MAX_PIXELS, PHOTO_MAX_SIDE, PHOTO_SOURCE_MAX_BYTES } from "./photo-limits";
import { typeError, type SniffedType } from "./photo-sniff";

/**
 * What the writer reads when a profile photo or a novel cover (Phase 25)
 * can't be used (toast and inline). Pure and client-safe.
 */
export type PhotoProblem =
  | "not_found"
  | "too_large"
  | "source_too_large"
  | "empty"
  | "type"
  | "dimensions"
  | "crop"
  | "unreadable"
  | "rate_limited"
  | "storage"
  | "no_file";

/** Which upload the words are about: the same checks, a different noun. */
export type ImageUse = "photo" | "cover";

export function photoProblemMessage(problem: PhotoProblem, type?: SniffedType, use: ImageUse = "photo"): string {
  const cover = use === "cover";
  switch (problem) {
    case "not_found":
      return "This novel no longer exists or isn't yours.";
    case "too_large":
      return `That ${cover ? "picture" : "photo"} is too big. Choose one under ${formatMegabytes(PHOTO_MAX_BYTES)}.`;
    case "source_too_large":
      return `That ${cover ? "picture" : "photo"} is too big. Choose one under ${formatMegabytes(PHOTO_SOURCE_MAX_BYTES)}.`;
    case "empty":
    case "no_file":
      return cover ? "Choose a picture first." : "Choose a photo first.";
    case "type":
      return typeError(type ?? "unknown");
    case "dimensions":
      return `That ${cover ? "picture" : "photo"} has too many pixels (at most ${PHOTO_MAX_SIDE.toLocaleString("en")} on a side and ${PHOTO_MAX_PIXELS / 1_000_000} megapixels).`;
    case "crop":
      return `That part of the ${cover ? "picture" : "photo"} is too small. Zoom out a little and try again.`;
    case "unreadable":
      return `That ${cover ? "picture" : "photo"} couldn't be read. It may be damaged; try another one.`;
    case "rate_limited":
      return cover
        ? "You've changed covers many times in the last hour. Try again later."
        : "You've changed your photo many times in the last hour. Try again later.";
    case "storage":
      return cover
        ? "The cover couldn't be stored just now. The old cover is unchanged; please try again later."
        : "Your photo couldn't be stored just now. Your old picture is unchanged; please try again later.";
  }
}
