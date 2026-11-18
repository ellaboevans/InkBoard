import { stripPoemMarkdown } from "@/lib/poem-markdown";
import { coverHex, type CoverSpec } from "@/lib/novel-cover";
import { BRAND, SITE_NAME } from "@/lib/site";
import { ogFontFamily, truncate } from "./og-type";

export { truncate };

/*
 * Shared JSX for ImageResponse (Satori): flexbox only, inline styles, hex
 * colours. The mark is the same lucide Feather on an ink-red tile that the
 * app shows in its header and sidebar (and in src/app/icon.svg).
 *
 * Every piece of text sets its own fontFamily with ogFontFamily (og-type.ts):
 * Gentium Book Plus first for Ghanaian letters and tone marks, Newsreader
 * first otherwise (tests/lib/og-font-order.test.ts walks the tree).
 */

export const OG_SIZE = { width: 1200, height: 630 };
/** The author's picture on link cards (from the 512 px JPEG copy). */
export const OG_PICTURE = 120;

export const FEATHER_PATHS = [
  "M14.086 18.412A2 2 0 0112.67 19H5v-7.672a2 2 0 01.586-1.414L11.75 3.75a6 6 0 118.49 8.49z",
  "M16 8 2 22",
  "M17.488 15H9",
];

/** `tile`/`glyph` default to the brand's; the share image's Ink design lightens them for a dark page. */
export function LogoMark({ size, tile = BRAND.primary, glyph = BRAND.onPrimary }: { size: number; tile?: string; glyph?: string }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: tile,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        width={size * 0.58}
        height={size * 0.58}
        viewBox="0 0 24 24"
        fill="none"
        stroke={glyph}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {FEATHER_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </div>
  );
}

/**
 * A novel's drawn cover on a link card (Phase 23b): the title and pen name on
 * the paper tone of the author's hue, with a spine, like NovelCover on the
 * page. Only the novel's title and the pen name: never chapter text.
 */
export function OgCover({ title, penName, hue }: CoverSpec) {
  const ink = coverHex("ink", hue);
  const shown = truncate(title, 60);
  const author = penName.toUpperCase();
  return (
    <div
      style={{
        width: 240,
        height: 360,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "40px 22px 28px 24px",
        borderRadius: "6px 14px 14px 6px",
        borderLeft: `14px solid ${coverHex("spine", hue)}`,
        background: coverHex("paper", hue),
        color: ink,
        boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: shown.length > 32 ? 30 : 38, lineHeight: 1.08, fontFamily: ogFontFamily(shown) }}>
          {shown}
        </div>
        <div style={{ width: 64, height: 3, marginTop: 22, background: ink, opacity: 0.6, display: "flex" }} />
      </div>
      <div style={{ display: "flex", fontSize: 16, letterSpacing: 2, opacity: 0.85, fontFamily: ogFontFamily(author) }}>
        {truncate(author, 28)}
      </div>
    </div>
  );
}

/**
 * 1200×630 card: brand row at the top, then a kicker, a big title and an
 * optional quote. With a `cover` (novels), the drawn cover stands to the left
 * of the text and the title is set smaller to fit beside it.
 */
export function OgCard({
  kicker,
  title,
  quote,
  footer,
  picture,
  cover,
}: {
  kicker?: string;
  title: string;
  quote?: string | null;
  footer?: string;
  /** The author's photo or avatar as a data URI (pictureDataUri, src/server/author-picture.ts), drawn round at the top right. */
  picture?: string | null;
  /** A novel's drawn cover, beside the text (Phase 23b). */
  cover?: CoverSpec;
}) {
  const titleSize = cover
    ? title.length > 40 ? 52 : title.length > 20 ? 64 : 80
    : title.length > 60 ? 60 : title.length > 30 ? 76 : 96;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "64px 80px",
        background: BRAND.canvas,
        backgroundImage: `radial-gradient(${BRAND.dot} 2px, transparent 2px)`,
        backgroundSize: "32px 32px",
        color: BRAND.ink,
        fontFamily: ogFontFamily(""),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <LogoMark size={64} />
        <div style={{ fontSize: 40, fontFamily: ogFontFamily(SITE_NAME) }}>{SITE_NAME}</div>
        {picture && (
          // eslint-disable-next-line @next/next/no-img-element -- Satori, not the DOM
          <img
            src={picture}
            alt=""
            width={OG_PICTURE}
            height={OG_PICTURE}
            style={{ marginLeft: "auto", borderRadius: 999, border: `4px solid ${BRAND.paper}` }}
          />
        )}
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 56 }}>
        {cover && <OgCover {...cover} />}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {kicker && (
            <div style={{ fontSize: 30, color: BRAND.primary, fontStyle: "italic", marginBottom: 16, fontFamily: ogFontFamily(kicker) }}>
              {kicker}
            </div>
          )}
          <div style={{ fontSize: titleSize, lineHeight: 1.05, letterSpacing: -1, display: "flex", fontFamily: ogFontFamily(title) }}>
            {truncate(title, 90)}
          </div>
          {quote && (
            <div
              style={{
                marginTop: 28,
                fontSize: 30,
                lineHeight: 1.4,
                color: BRAND.muted,
                fontStyle: "italic",
                whiteSpace: "pre-wrap",
                display: "flex",
                fontFamily: ogFontFamily(quote),
              }}
            >
              {quote}
            </div>
          )}
        </div>
      </div>
      {footer && <div style={{ fontSize: 26, color: BRAND.muted, display: "flex", fontFamily: ogFontFamily(footer) }}>{footer}</div>}
    </div>
  );
}

/** First lines of a public poem for the card, kept short enough to fit. */
export function ogQuote(body: string | null, lines = 3) {
  if (!body) return null;
  const head = stripPoemMarkdown(body).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, lines);
  return head.map((l) => truncate(l, 64)).join("\n") || null;
}
