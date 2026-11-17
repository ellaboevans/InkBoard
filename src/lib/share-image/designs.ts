import { BRAND } from "@/lib/site";

/*
 * The share image's three looks (docs/PLAN.md, Phase 21 round 3): Page (the
 * default), Ink and Board. Colours only: every design uses the same layout
 * (src/lib/share-image/layout.ts), so a poem breaks the same way and fits the
 * same safe area in each. Pure, shared by the picture, the sheet's swatches
 * and the contrast test (tests/lib/share-designs.test.ts), which holds every
 * text colour to 4.5:1 on what it sits on, and the poem's to 7:1.
 *
 *   Page   paper, ink text, the ink-red accent.
 *   Ink    a dark page: InkBoard's ink as the background, paper text; the accent
 *          lightened to a coral that reads on ink (the brand red doesn't:
 *          1.9:1), the divider and the logo tile lightened to reach 3:1.
 *   Board  the board itself: the canvas colour and its dot grid, the poem on a
 *          paper card. The card is the content area grown by CARD_BLEED on every
 *          side, so text sits exactly where it does on Page (on paper, with
 *          Page's colours). A border and a hard offset shadow (no blur, which
 *          made the prototype's Board ten times slower) give it its edge.
 */

export type ShareDesignStyle = {
  /** What the swatch and the sheet call it. */
  label: string;
  /** The picture's background (Board: the canvas around the card). */
  background: string;
  /** What the text sits on: the background, or Board's card. */
  surface: string;
  text: string;
  muted: string;
  accent: string;
  /** The hairline between the byline and the address. */
  divider: string;
  logo: { tile: string; glyph: string };
  /** Board only. */
  card?: { border: string; shadow: string };
  dots?: { color: string; spacing: number; radius: number };
};

export const SHARE_DESIGNS = {
  page: {
    label: "Page",
    background: BRAND.paper,
    surface: BRAND.paper,
    text: BRAND.ink,
    muted: BRAND.muted,
    accent: BRAND.primary,
    divider: "#e4dbcd",
    logo: { tile: BRAND.primary, glyph: BRAND.onPrimary },
  },
  ink: {
    label: "Ink",
    background: BRAND.ink,
    surface: BRAND.ink,
    text: BRAND.paper,
    muted: "#cbbca9",
    accent: "#eda59b",
    divider: "#7a6a5c",
    logo: { tile: "#b4433f", glyph: BRAND.paper },
  },
  board: {
    label: "Board",
    background: BRAND.canvas,
    surface: BRAND.paper,
    text: BRAND.ink,
    muted: BRAND.muted,
    accent: BRAND.primary,
    divider: "#e4dbcd",
    logo: { tile: BRAND.primary, glyph: BRAND.onPrimary },
    card: { border: "#bdae99", shadow: "#e2d8c9" },
    dots: { color: BRAND.dot, spacing: 44, radius: 3 },
  },
} as const satisfies Record<string, ShareDesignStyle>;

export type ShareDesign = keyof typeof SHARE_DESIGNS;
export const SHARE_DESIGN_NAMES = Object.keys(SHARE_DESIGNS) as ShareDesign[];

/** How far Board's card reaches past the content area on every side (into the margins). */
export const CARD_BLEED = 40;
/** Board's card: corner radius, border width, and the offset of its hard shadow. */
export const CARD = { radius: 36, border: 2, shadowOffset: 10 } as const;
