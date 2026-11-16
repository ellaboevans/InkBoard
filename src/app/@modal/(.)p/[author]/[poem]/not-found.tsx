import { OverlayNotFoundTitle } from "@/components/poem/overlay-poem-shown";

/**
 * A poem opened from the board (a soft navigation, so no HTTP status is
 * involved) that has gone since the board was loaded: "Poem not found" inside
 * the overlay, over the board. Without this file the notFound() in PoemReader
 * reached the root and replaced the whole page, board included, with Next's
 * default 404. Closing goes back to the board as usual.
 */
export default function OverlayPoemNotFound() {
  return (
    <div className="grid justify-items-start gap-3 pt-14 pb-4">
      <OverlayNotFoundTitle>Poem not found</OverlayNotFoundTitle>
      <p className="text-muted-foreground">It may have been unpublished or moved.</p>
    </div>
  );
}
