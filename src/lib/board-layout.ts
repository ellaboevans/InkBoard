/**
 * Deterministic catalogue layout for the board (R9): each author gets a
 * "shelf" (section) holding a grid of poem cards; shelves are packed into
 * rows, A–Z, with a row width chosen to keep the whole board roughly 16:10.
 * All values are in world units (px at 100% zoom).
 */

export const CARD_W = 264;
export const CARD_H = 184;
export const CARD_GAP = 20;
export const SECTION_PAD = 28;
export const SECTION_HEADER = 76;
export const SECTION_GAP = 96;
export const SECTION_MIN_W = 340;
export const MAX_COLS = 4;

export type Rect = { x: number; y: number; w: number; h: number };
export type CardBox = Rect & { poemId: string };
export type SectionBox = Rect & { editorId: string; cols: number; cards: CardBox[] };
export type BoardLayout = { sections: SectionBox[]; bounds: Rect };

type Input = { editorId: string; poems: { id: string }[] };

/** Columns for a section: roughly square-ish, wider than tall, at most 4. */
export function columnsFor(count: number): number {
  if (count <= 1) return 1;
  return Math.min(MAX_COLS, count, Math.ceil(Math.sqrt(count * 1.5)));
}

function sectionSize(count: number) {
  const cols = columnsFor(count);
  const rows = Math.max(1, Math.ceil(count / cols));
  const w = Math.max(
    SECTION_MIN_W,
    SECTION_PAD * 2 + cols * CARD_W + (cols - 1) * CARD_GAP,
  );
  const h = SECTION_HEADER + SECTION_PAD + rows * CARD_H + (rows - 1) * CARD_GAP;
  return { cols, w, h };
}

export function layoutBoard(sections: Input[]): BoardLayout {
  const sizes = sections.map((s) => sectionSize(s.poems.length));
  if (sizes.length === 0) {
    return { sections: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
  }

  // Target row width from total area so the board isn't one long strip.
  // Shelves in a row have uneven heights, so aim wider than the ~16:10
  // screen we want to end up with.
  const area = sizes.reduce((sum, s) => sum + (s.w + SECTION_GAP) * (s.h + SECTION_GAP), 0);
  const widest = Math.max(...sizes.map((s) => s.w));
  const rowWidth = Math.max(widest, Math.sqrt(area * 2.4));

  const boxes: SectionBox[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let maxX = 0;

  sections.forEach((section, i) => {
    const { cols, w, h } = sizes[i];
    if (x > 0 && x + w > rowWidth) {
      x = 0;
      y += rowHeight + SECTION_GAP;
      rowHeight = 0;
    }
    const cards = section.poems.map((poem, j) => ({
      poemId: poem.id,
      x: x + SECTION_PAD + (j % cols) * (CARD_W + CARD_GAP),
      y: y + SECTION_HEADER + Math.floor(j / cols) * (CARD_H + CARD_GAP),
      w: CARD_W,
      h: CARD_H,
    }));
    boxes.push({ editorId: section.editorId, x, y, w, h, cols, cards });
    maxX = Math.max(maxX, x + w);
    rowHeight = Math.max(rowHeight, h);
    x += w + SECTION_GAP;
  });

  return { sections: boxes, bounds: { x: 0, y: 0, w: maxX, h: y + rowHeight } };
}

/** Stable per-author accent hue (0–360) so a section keeps its colour. */
export function sectionHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 360;
}
