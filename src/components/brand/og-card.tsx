import { BRAND, SITE_NAME } from "@/lib/site";

/*
 * Shared JSX for ImageResponse (Satori): flexbox only, inline styles, hex
 * colours. The mark is the same lucide Feather on an ink-red tile that the
 * app shows in its header and sidebar (and in src/app/icon.svg).
 */

export const OG_SIZE = { width: 1200, height: 630 };

export const FEATHER_PATHS = [
  "M14.086 18.412A2 2 0 0112.67 19H5v-7.672a2 2 0 01.586-1.414L11.75 3.75a6 6 0 118.49 8.49z",
  "M16 8 2 22",
  "M17.488 15H9",
];

export function LogoMark({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: BRAND.primary,
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
        stroke={BRAND.onPrimary}
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

/** 1200×630 card: brand row at the top, then a kicker, a big title and an optional quote. */
export function OgCard({
  kicker,
  title,
  quote,
  footer,
}: {
  kicker?: string;
  title: string;
  quote?: string | null;
  footer?: string;
}) {
  const titleSize = title.length > 60 ? 60 : title.length > 30 ? 76 : 96;
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
        fontFamily: "Newsreader",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <LogoMark size={64} />
        <div style={{ fontSize: 40 }}>{SITE_NAME}</div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {kicker && (
          <div style={{ fontSize: 30, color: BRAND.primary, fontStyle: "italic", marginBottom: 16 }}>
            {kicker}
          </div>
        )}
        <div style={{ fontSize: titleSize, lineHeight: 1.05, letterSpacing: -1, display: "flex" }}>
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
            }}
          >
            {quote}
          </div>
        )}
      </div>
      {footer && <div style={{ fontSize: 26, color: BRAND.muted, display: "flex" }}>{footer}</div>}
    </div>
  );
}

export function truncate(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** First lines of a public poem for the card, kept short enough to fit. */
export function ogQuote(body: string | null, lines = 3) {
  if (!body) return null;
  const head = body.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, lines);
  return head.map((l) => truncate(l, 64)).join("\n") || null;
}
