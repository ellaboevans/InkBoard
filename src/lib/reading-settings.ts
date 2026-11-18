/**
 * Reader settings for chapter pages (docs/PLAN.md, Phase 26): the chapter
 * text's size and font, kept only in this browser, under one localStorage
 * key, like "where you stopped" (src/lib/reading-place.ts). Never sent to the
 * server, no cookie carries it, the service worker doesn't touch it.
 *
 *   localStorage["inkboard-reading-text"] = { "v": 1, "size": "larger", "font": "sans" }
 *
 * Anything unreadable (another version, a removed step, hand-edited, cut
 * short) falls back field by field to the defaults rather than throwing.
 *
 * How it's applied: the setting becomes a few lines of CSS (readingSettingsCss)
 * in one <style id="inkboard-reading-text"> in <head>, aimed at
 * `[data-chapter-text]` only. The chapter page's static shell runs
 * READING_SETTINGS_SCRIPT inline, before the text is parsed, so the first
 * paint already has the reader's size and font (no flash), and the React tree
 * is never touched (no hydration mismatch). The control rewrites the same
 * <style> on a change. The default is no CSS at all: today's sizes
 * (globals.css / the chapter page's classes) stay exactly as they were.
 *
 * Sizes are multiples of the article's own size (19 px; 18 px under 360 px;
 * 21 px from 768 px), so each step keeps those breakpoints.
 */

export const READING_TEXT_KEY = "inkboard-reading-text";
export const READING_TEXT_STYLE_ID = "inkboard-reading-text";

export const READING_SIZES = [
  { id: "smaller", label: "Smaller", scale: 0.9 },
  { id: "default", label: "Default", scale: 1 },
  { id: "larger", label: "Larger", scale: 1.15 },
  { id: "largest", label: "Largest", scale: 1.3 },
] as const;
export const READING_FONTS = [
  { id: "serif", label: "Book serif" },
  { id: "sans", label: "Sans" },
] as const;

export type ReadingSize = (typeof READING_SIZES)[number]["id"];
export type ReadingFont = (typeof READING_FONTS)[number]["id"];
export type ReadingSettings = { size: ReadingSize; font: ReadingFont };

export const DEFAULT_READING_SETTINGS: ReadingSettings = { size: "default", font: "serif" };

const isSize = (s: unknown): s is ReadingSize => READING_SIZES.some((x) => x.id === s);
const isFont = (f: unknown): f is ReadingFont => READING_FONTS.some((x) => x.id === f);

/** The stored settings; each missing or unknown field is its default. */
export function parseReadingSettings(raw: string | null | undefined): ReadingSettings {
  if (!raw) return { ...DEFAULT_READING_SETTINGS };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_READING_SETTINGS };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data) || (data as { v?: unknown }).v !== 1) {
    return { ...DEFAULT_READING_SETTINGS };
  }
  const { size, font } = data as { size?: unknown; font?: unknown };
  return { size: isSize(size) ? size : DEFAULT_READING_SETTINGS.size, font: isFont(font) ? font : DEFAULT_READING_SETTINGS.font };
}

export function serializeReadingSettings(s: ReadingSettings): string {
  return JSON.stringify({ v: 1, size: s.size, font: s.font });
}

/**
 * The CSS for these settings ("" for the defaults). `--font-sans` is the sans
 * stack from the root layout (Geist → Andika → metric fallback), so Ghanaian
 * letters and their tone marks come from one font in either choice. The text
 * may break inside a word that can't fit (a long word at the largest size on
 * a 320 px phone) instead of overflowing.
 */
export function readingSettingsCss(s: ReadingSettings): string {
  const rules: string[] = [];
  const scale = READING_SIZES.find((x) => x.id === s.size)?.scale ?? 1;
  if (scale !== 1) rules.push(`font-size:${scale}em`);
  if (s.font === "sans") rules.push("font-family:var(--font-sans)");
  return rules.length ? `[data-chapter-text]{${rules.join(";")}}` : "";
}

/**
 * The inline script in the chapter page's shell: the same rules as above in
 * plain ES5 (no imports at runtime), checked against the TypeScript by
 * tests/lib/reading-settings.test.ts, which evaluates it.
 */
export const READING_SETTINGS_SCRIPT = `(function(){try{
var S=${JSON.stringify(Object.fromEntries(READING_SIZES.map((x) => [x.id, x.scale])))},F=${JSON.stringify(READING_FONTS.map((x) => x.id))};
var d=JSON.parse(localStorage.getItem(${JSON.stringify(READING_TEXT_KEY)})||"null");
if(!d||typeof d!=="object"||d.v!==1)return;
var r=[];
if(Object.prototype.hasOwnProperty.call(S,d.size)&&S[d.size]!==1)r.push("font-size:"+S[d.size]+"em");
if(F.indexOf(d.font)>=0&&d.font==="sans")r.push("font-family:var(--font-sans)");
if(!r.length)return;
var el=document.getElementById(${JSON.stringify(READING_TEXT_STYLE_ID)});
if(!el){el=document.createElement("style");el.id=${JSON.stringify(READING_TEXT_STYLE_ID)};document.head.appendChild(el);}
el.textContent="[data-chapter-text]{"+r.join(";")+"}";
}catch(e){}})();`;
