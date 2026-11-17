import { describe, expect, it } from "vitest";
import {
  clampView,
  cropFromView,
  cropToPixels,
  encodeCrop,
  initialView,
  panRange,
  panView,
  parseCrop,
} from "@/lib/photo-crop";

describe("crop maths (Phase 22)", () => {
  it("starts with the largest centred square", () => {
    expect(cropFromView(initialView(), 4000, 3000)).toEqual({ x: 0.125, y: 0, size: 1 });
    expect(cropToPixels(cropFromView(initialView(), 4000, 3000), 4000, 3000)).toEqual({ left: 500, top: 0, side: 3000 });
    // Portrait: the square is centred vertically.
    expect(cropToPixels(cropFromView(initialView(), 3000, 4000), 3000, 4000)).toEqual({ left: 0, top: 500, side: 3000 });
    expect(cropToPixels(cropFromView(initialView(), 500, 500), 500, 500)).toEqual({ left: 0, top: 0, side: 500 });
  });

  it("zooms around the centre and keeps the square inside the photo", () => {
    expect(cropToPixels(cropFromView({ zoom: 2, cx: 0.5, cy: 0.5 }, 4000, 3000), 4000, 3000)).toEqual({ left: 1250, top: 750, side: 1500 });
    // A centre pushed past an edge is pulled back so the square still fits.
    expect(clampView({ zoom: 2, cx: 0, cy: 1 }, 4000, 3000)).toEqual({ zoom: 2, cx: 1500 / 2 / 4000, cy: 1 - 1500 / 2 / 3000 });
    expect(cropToPixels(cropFromView({ zoom: 2, cx: 0, cy: 1 }, 4000, 3000), 4000, 3000)).toEqual({ left: 0, top: 1500, side: 1500 });
    expect(clampView({ zoom: 99, cx: 0.5, cy: 0.5 }, 100, 100).zoom).toBe(4);
    expect(clampView({ zoom: 0.1, cx: 0.5, cy: 0.5 }, 100, 100).zoom).toBe(1);
    expect(clampView({ zoom: Number.NaN, cx: Number.NaN, cy: 0.5 }, 100, 100)).toEqual({ zoom: 1, cx: 0.5, cy: 0.5 });
  });

  it("pans by a drag: dragging the photo right shows more of its left", () => {
    const v = { zoom: 2, cx: 0.5, cy: 0.5 };
    const moved = panView(v, 100, 0, 200, 4000, 3000); // half the box to the right
    expect(moved.cx).toBeCloseTo(0.5 - 0.5 * (1500 / 4000));
    expect(moved.cy).toBe(0.5);
    // At zoom 1 on a landscape photo, there's no vertical room at all.
    expect(panRange({ zoom: 1, cx: 0.5, cy: 0.5 }, 4000, 3000).y).toEqual([0.5, 0.5]);
  });

  it("a crop means the same on a shrunk copy of the photo (the browser's smaller upload)", () => {
    const crop = cropFromView({ zoom: 1.7, cx: 0.31, cy: 0.62 }, 6000, 4000);
    const big = cropToPixels(crop, 6000, 4000)!;
    const small = cropToPixels(crop, 3000, 2000)!;
    expect(Math.abs(big.left / 2 - small.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(big.top / 2 - small.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(big.side / 2 - small.side)).toBeLessThanOrEqual(1);
  });

  it("travels as one short field, parsed strictly", () => {
    const crop = cropFromView({ zoom: 3, cx: 0.4, cy: 0.7 }, 1234, 987);
    const back = parseCrop(encodeCrop(crop))!;
    expect(back.x).toBeCloseTo(crop.x, 5);
    expect(back.size).toBeCloseTo(1 / 3, 5);
    expect(parseCrop("0,0,1")).toEqual({ x: 0, y: 0, size: 1 });
    for (const bad of [null, 3, "", "0,0", "0,0,0", "-0.1,0,1", "0,0,1.5", "1e-3,0,1", "0,0,1,2", " 0,0,1", "NaN,0,1", "0x1,0,1", "0.1".repeat(20)]) {
      expect(parseCrop(bad), String(bad)).toBeNull();
    }
  });

  it("refuses a crop that falls outside the photo or is too small", () => {
    expect(cropToPixels({ x: 0.5, y: 0, size: 1 }, 4000, 3000)).toBeNull(); // 2000 + 3000 > 4000
    expect(cropToPixels({ x: 0, y: 0.5, size: 1 }, 4000, 3000)).toBeNull();
    expect(cropToPixels({ x: 0, y: 0, size: 0.01 }, 4000, 3000, 64)).toBeNull(); // 30 px
    expect(cropToPixels({ x: 0, y: 0, size: 0.03 }, 4000, 3000, 64)).toEqual({ left: 0, top: 0, side: 90 });
  });
});
