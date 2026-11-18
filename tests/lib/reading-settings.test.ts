import { describe, expect, it } from "vitest";
import {
  DEFAULT_READING_SETTINGS,
  parseReadingSettings,
  READING_FONTS,
  READING_SETTINGS_SCRIPT,
  READING_SIZES,
  READING_TEXT_KEY,
  READING_TEXT_STYLE_ID,
  readingSettingsCss,
  serializeReadingSettings,
} from "@/lib/reading-settings";

describe("reading settings (Phase 26)", () => {
  it("round-trips every size and font", () => {
    for (const { id: size } of READING_SIZES)
      for (const { id: font } of READING_FONTS)
        expect(parseReadingSettings(serializeReadingSettings({ size, font }))).toEqual({ size, font });
  });

  it.each([
    null,
    undefined,
    "",
    "not json",
    '{"v":1,',
    "null",
    "42",
    '"larger"',
    "[]",
    '{"size":"larger","font":"sans"}',
    '{"v":2,"size":"larger","font":"sans"}',
    '{"v":"1","size":"larger","font":"sans"}',
  ])("falls back to the defaults for %j", (raw) => {
    expect(parseReadingSettings(raw)).toEqual(DEFAULT_READING_SETTINGS);
  });

  it("keeps a good field when the other is unknown or old", () => {
    expect(parseReadingSettings('{"v":1,"size":"huge","font":"sans"}')).toEqual({ size: "default", font: "sans" });
    expect(parseReadingSettings('{"v":1,"size":"larger","font":"mono"}')).toEqual({ size: "larger", font: "serif" });
    expect(parseReadingSettings('{"v":1,"size":"__proto__","font":"toString"}')).toEqual(DEFAULT_READING_SETTINGS);
  });

  it("the default is today's text: no CSS at all", () => {
    expect(readingSettingsCss(DEFAULT_READING_SETTINGS)).toBe("");
  });

  it("aims at the chapter text only, scaling today's size and using the sans stack", () => {
    expect(readingSettingsCss({ size: "largest", font: "sans" })).toBe("[data-chapter-text]{font-size:1.3em;font-family:var(--font-sans)}");
    expect(readingSettingsCss({ size: "smaller", font: "serif" })).toBe("[data-chapter-text]{font-size:0.9em}");
  });

  it("has a few steps around today's size, today's in the middle", () => {
    const scales = READING_SIZES.map((s) => s.scale);
    expect(scales).toEqual([...scales].sort((a, b) => a - b));
    expect(scales).toContain(1);
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.85);
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.35);
  });

  describe("the inline script matches the rules", () => {
    function runScript(stored: string | null | (() => never)) {
      const els = new Map<string, { id: string; textContent: string }>();
      const document = {
        getElementById: (id: string) => els.get(id) ?? null,
        createElement: () => ({ id: "", textContent: "" }),
        head: { appendChild: (el: { id: string; textContent: string }) => void els.set(el.id, el) },
      };
      const localStorage = {
        getItem: (k: string) => {
          if (typeof stored === "function") stored();
          return k === READING_TEXT_KEY ? stored : null;
        },
      };
      new Function("document", "localStorage", READING_SETTINGS_SCRIPT)(document, localStorage);
      return els.get(READING_TEXT_STYLE_ID)?.textContent ?? "";
    }

    const samples = [
      null,
      "garbage",
      "[]",
      '{"v":2,"size":"larger"}',
      '{"v":1,"size":"huge","font":"sans"}',
      '{"v":1,"size":"constructor"}',
      ...READING_SIZES.flatMap((s) => READING_FONTS.map((f) => serializeReadingSettings({ size: s.id, font: f.id }))),
    ];
    it.each(samples)("%j", (raw) => {
      expect(runScript(raw)).toBe(readingSettingsCss(parseReadingSettings(raw)));
    });

    it("never throws when storage does", () => {
      expect(runScript(() => { throw new Error("SecurityError"); })).toBe("");
    });
  });
});
