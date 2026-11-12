import { describe, expect, it } from "vitest";
import { CARD_H, CARD_W, columnsFor, layoutBoard, sectionHue, type Rect } from "@/lib/board-layout";

const sections = (counts: number[]) =>
  counts.map((n, i) => ({
    editorId: `e${i}`,
    poems: Array.from({ length: n }, (_, j) => ({ id: `e${i}-p${j}` })),
  }));

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

describe("layoutBoard", () => {
  it("is empty for no sections", () => {
    expect(layoutBoard([])).toEqual({ sections: [], bounds: { x: 0, y: 0, w: 0, h: 0 } });
  });

  it.each([[[1]], [[5, 12, 4, 7, 3, 5, 2, 4, 1, 5]], [Array.from({ length: 40 }, (_, i) => (i % 9) + 1)]])(
    "never overlaps sections or cards, and keeps cards inside their section (%#)",
    (counts) => {
      const { sections: boxes, bounds } = layoutBoard(sections(counts));
      for (let i = 0; i < boxes.length; i++) {
        expect(inside(boxes[i], bounds)).toBe(true);
        for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
        const cards = boxes[i].cards;
        expect(cards).toHaveLength(counts[i]);
        for (let a = 0; a < cards.length; a++) {
          expect(inside(cards[a], boxes[i])).toBe(true);
          for (let b = a + 1; b < cards.length; b++) expect(overlaps(cards[a], cards[b])).toBe(false);
        }
      }
    },
  );

  it("keeps catalogue order: left-to-right, then top-to-bottom", () => {
    const { sections: boxes } = layoutBoard(sections([5, 12, 4, 7, 3, 5, 2, 4, 1, 5]));
    for (let i = 1; i < boxes.length; i++) {
      const prev = boxes[i - 1];
      const cur = boxes[i];
      expect(cur.y > prev.y || (cur.y === prev.y && cur.x > prev.x)).toBe(true);
    }
  });

  it("produces a roughly landscape board rather than a strip", () => {
    const { bounds } = layoutBoard(sections(Array.from({ length: 30 }, () => 5)));
    expect(bounds.w / bounds.h).toBeGreaterThan(0.8);
    expect(bounds.w / bounds.h).toBeLessThan(4);
  });

  it("is deterministic and uses fixed card sizes", () => {
    const input = sections([3, 8, 1]);
    expect(layoutBoard(input)).toEqual(layoutBoard(input));
    for (const c of layoutBoard(input).sections.flatMap((s) => s.cards)) {
      expect([c.w, c.h]).toEqual([CARD_W, CARD_H]);
    }
  });

  it("picks sensible column counts", () => {
    expect([1, 2, 3, 4, 5, 8, 12, 30].map(columnsFor)).toEqual([1, 2, 3, 3, 3, 4, 4, 4]);
  });

  it("gives each author a stable hue", () => {
    expect(sectionHue("abc")).toBe(sectionHue("abc"));
    expect(sectionHue("abc")).toBeGreaterThanOrEqual(0);
    expect(sectionHue("abc")).toBeLessThan(360);
  });
});
