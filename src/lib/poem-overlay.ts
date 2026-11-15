/**
 * The board overlay's accessible name (CLAUDE.md, "Poem overlay"). The dialog
 * shell lives in a layout that stays mounted while you step between poems,
 * and Next keeps previously shown poems mounted but hidden (<Activity>). So
 * the name can't come from a fixed id or Radix's shared title id: both could
 * resolve to a hidden poem. Instead each poem's <h1> gets an id from its own
 * author and slug, and the poem being shown points the dialog's
 * aria-labelledby at it (OverlayPoemShown): hidden poems never run effects,
 * so they can't.
 */

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]/g, "_");

export const poemTitleId = (authorSlug: string, poemSlug: string) => `poem-title--${clean(authorSlug)}--${clean(poemSlug)}`;

/** Names the overlay while a poem is still loading (the skeleton's "Loading poem"). */
export const OVERLAY_LOADING_ID = "poem-overlay-loading";
