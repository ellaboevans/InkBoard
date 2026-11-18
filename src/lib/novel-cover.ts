/**
 * The drawn cover's colours (docs/PLAN.md, Phase 23b): paper, ink and spine
 * tones of the author's section hue (sectionHue). One source for the page's
 * NovelCover (CSS oklch) and the link cards (Satori, which needs hex).
 */

export const COVER_TONES = {
  paper: { l: 0.9, c: 0.05 },
  ink: { l: 0.3, c: 0.08 },
  spine: { l: 0.82, c: 0.06 },
} as const;

type Tone = keyof typeof COVER_TONES;

export function coverCss(tone: Tone, hue: number): string {
  const { l, c } = COVER_TONES[tone];
  return `oklch(${l} ${c} ${hue})`;
}

/** OKLCH → sRGB hex (Björn Ottosson's OKLab matrices), clamped to the sRGB gamut. */
export function oklchToHex(l: number, c: number, hue: number): string {
  const h = (hue * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return `#${linear
    .map((v) => {
      const x = Math.min(1, Math.max(0, v));
      const srgb = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
      return Math.round(srgb * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

export function coverHex(tone: Tone, hue: number): string {
  const { l, c } = COVER_TONES[tone];
  return oklchToHex(l, c, hue);
}

/** What a link card draws as the cover (no text of the chapters, ever). */
export type CoverSpec = { title: string; penName: string; hue: number };
