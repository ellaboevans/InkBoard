import { formatMegabytes, PHOTO_MAX_BYTES, PHOTO_MAX_PIXELS, PHOTO_MAX_SIDE, PHOTO_SOURCE_MAX_BYTES } from "./photo-limits";
import { typeError, type SniffedType } from "./photo-sniff";

/** What the writer reads when a photo can't be used (toast and inline). Pure and client-safe. */
export type PhotoProblem =
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

export function photoProblemMessage(problem: PhotoProblem, type?: SniffedType): string {
  switch (problem) {
    case "too_large":
      return `That photo is too big. Choose one under ${formatMegabytes(PHOTO_MAX_BYTES)}.`;
    case "source_too_large":
      return `That photo is too big. Choose one under ${formatMegabytes(PHOTO_SOURCE_MAX_BYTES)}.`;
    case "empty":
    case "no_file":
      return "Choose a photo first.";
    case "type":
      return typeError(type ?? "unknown");
    case "dimensions":
      return `That photo has too many pixels (at most ${PHOTO_MAX_SIDE.toLocaleString("en")} on a side and ${PHOTO_MAX_PIXELS / 1_000_000} megapixels).`;
    case "crop":
      return "That part of the photo is too small. Zoom out a little and try again.";
    case "unreadable":
      return "That photo couldn't be read. It may be damaged; try another one.";
    case "rate_limited":
      return "You've changed your photo many times in the last hour. Try again later.";
    case "storage":
      return "Your photo couldn't be stored just now. Your old picture is unchanged; please try again later.";
  }
}
