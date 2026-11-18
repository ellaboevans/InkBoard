import { CARD, CARD_BLEED, SHARE_DESIGNS, type ShareDesign, type ShareDesignStyle } from "@/lib/share-image/designs";
import {
  ADDRESS,
  BYLINE,
  CONTENT_WIDTH,
  GAPS,
  OMISSION_TEXT,
  contentHeight,
  type PoemRow,
  type ShareImageLayout,
} from "@/lib/share-image/layout";
import { LogoMark } from "./og-card";
import { fontFamilyList as family, ogFontFamily } from "./og-type";

/*
 * The "Share as image" picture (docs/PLAN.md, Phase 21): 1080×1920 or
 * 1080×1350 (layout.frame), whole or as "Lines from", in the Page, Ink or Board
 * design (src/lib/share-image/designs.ts), drawn by Satori (next/og) from a
 * layout computed and measured in src/lib/share-image/layout.ts. Every row is
 * placed here with an explicit height and `whiteSpace: "pre"`, so Satori never
 * re-wraps anything and the picture can't outgrow the safe area. The designs
 * change colours only (and Board's canvas and card behind the content), never
 * where text goes. Fonts: ogFontFamily (og-type.ts), so Ghanaian letters and
 * tone marks are set in Gentium Book Plus first.
 *
 * Passages (Phase 25, src/lib/share-image/passage-layout.ts) are drawn by
 * this same component from the same layout type: a kicker ("A passage
 * from"), the novel's title, a subtitle ("Chapter 4 · The Radio"), the
 * reflowed paragraphs as rows, and "Read the chapter on InkBoard" when cut.
 */

function PoemRows({ layout, look }: { layout: ShareImageLayout; look: ShareDesignStyle }) {
  const { poem } = layout;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: CONTENT_WIDTH,
        fontSize: poem.size,
        lineHeight: `${poem.rowHeight}px`,
        color: look.text,
        fontFamily: family(poem.extendedFirst, "text"),
      }}
    >
      {poem.rows.map((row, i) => (
        <Row key={i} row={row} rowHeight={poem.rowHeight} gapHeight={poem.gapHeight} breakHeight={poem.breakHeight} muted={look.muted} />
      ))}
    </div>
  );
}

function Row({
  row,
  rowHeight,
  gapHeight,
  breakHeight,
  muted,
}: {
  row: PoemRow;
  rowHeight: number;
  gapHeight: number;
  breakHeight: number;
  muted: string;
}) {
  if (row.kind === "gap") return <div style={{ display: "flex", height: gapHeight }} />;
  // A passage's scene break (Phase 25): a wider gap, no glyph, as the reader asked.
  if (row.kind === "scene") return <div style={{ display: "flex", height: breakHeight }} />;
  if (row.kind === "omission") {
    // Where a quote skips lines: one stanza gap high, so the layout's sums hold.
    return (
      <div style={{ display: "flex", alignItems: "center", height: gapHeight, lineHeight: `${gapHeight}px`, color: muted, whiteSpace: "pre" }}>
        {OMISSION_TEXT}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", height: rowHeight, paddingLeft: row.indent, whiteSpace: "pre" }}>
      {row.words.flatMap((w, wi) =>
        w.pieces.map((p, pi) => (
          <span
            key={`${wi}-${pi}`}
            style={{
              marginLeft: pi === 0 ? w.gap : 0,
              fontStyle: p.italic ? "italic" : "normal",
              fontWeight: p.bold ? 700 : 400,
              whiteSpace: "pre",
            }}
          >
            {p.text}
          </span>
        )),
      )}
    </div>
  );
}

/**
 * Board's paper card: the content area grown by CARD_BLEED, so every word sits
 * where it does on Page. Its edge is a border and a hard offset shadow, drawn
 * as a second rectangle (a blurred box-shadow is what made the prototype slow).
 */
function BoardCard({ layout, look }: { layout: ShareImageLayout; look: ShareDesignStyle }) {
  // Satori places absolute children from the padding's inner edge, i.e. the content area.
  const box = {
    position: "absolute" as const,
    left: -CARD_BLEED,
    top: -CARD_BLEED,
    width: CONTENT_WIDTH + 2 * CARD_BLEED,
    height: contentHeight(layout.format) + 2 * CARD_BLEED,
    borderRadius: CARD.radius,
    display: "flex",
  };
  return (
    <>
      <div style={{ ...box, top: box.top + CARD.shadowOffset, background: look.card!.shadow }} />
      <div style={{ ...box, background: look.surface, border: `${CARD.border}px solid ${look.card!.border}` }} />
    </>
  );
}

/**
 * Board's dot grid as one small SVG: a pattern of solid circles. A CSS
 * radial-gradient background (the prototype's) made resvg paint a gradient
 * per dot, ten times slower than the whole Page picture.
 */
function DotGrid({ layout, dots }: { layout: ShareImageLayout; dots: NonNullable<ShareDesignStyle["dots"]> }) {
  const { width, height } = layout.frame;
  const half = dots.spacing / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs><pattern id="d" width="${dots.spacing}" height="${dots.spacing}" patternUnits="userSpaceOnUse">` +
    `<circle cx="${half}" cy="${half}" r="${dots.radius}" fill="${dots.color}"/></pattern></defs>` +
    `<rect width="100%" height="100%" fill="url(#d)"/></svg>`;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Satori, not the DOM
    <img
      src={`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`}
      width={width}
      height={height}
      // From the content area's corner back to the picture's (see BoardCard).
      style={{ position: "absolute", left: -layout.frame.side, top: -layout.frame.safeTop }}
      alt=""
    />
  );
}

export function ShareImage({
  layout,
  avatar,
  design = "page",
}: {
  layout: ShareImageLayout;
  avatar: string | null;
  design?: ShareDesign;
}) {
  const { title, byline, address, frame } = layout;
  const look: ShareDesignStyle = SHARE_DESIGNS[design];
  return (
    <div
      style={{
        position: "relative",
        width: frame.width,
        height: frame.height,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: look.background,
        color: look.text,
        fontFamily: ogFontFamily(""),
        paddingTop: frame.safeTop,
        paddingBottom: frame.safeBottom,
        paddingLeft: frame.side,
        paddingRight: frame.side,
      }}
    >
      {look.dots && <DotGrid layout={layout} dots={look.dots} />}
      {look.card && <BoardCard layout={layout} look={look} />}
      {/* Title, rule and poem, centred in the space above the byline. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          flexGrow: 1,
          paddingBottom: GAPS.beforeFooter,
        }}
      >
        {layout.kicker && (
          <div
            style={{
              display: "flex",
              height: GAPS.linesFrom * GAPS.linesFromLineHeight,
              marginBottom: GAPS.linesFromToTitle,
              fontSize: GAPS.linesFrom,
              lineHeight: `${GAPS.linesFrom * GAPS.linesFromLineHeight}px`,
              color: look.accent,
              fontStyle: "italic",
              fontFamily: ogFontFamily(layout.kicker),
              whiteSpace: "pre",
            }}
          >
            {layout.kicker}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", fontFamily: family(title.extendedFirst) }}>
          {title.rows.map((r, i) => (
            <div
              key={i}
              style={{ display: "flex", height: title.lineHeight, fontSize: title.size, lineHeight: `${title.lineHeight}px`, whiteSpace: "pre" }}
            >
              {r}
            </div>
          ))}
        </div>
        {layout.subtitle && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: GAPS.titleToSubtitle,
              color: look.muted,
              fontFamily: family(layout.subtitle.extendedFirst),
            }}
          >
            {layout.subtitle.rows.map((r, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  height: layout.subtitle!.lineHeight,
                  fontSize: layout.subtitle!.size,
                  lineHeight: `${layout.subtitle!.lineHeight}px`,
                  whiteSpace: "pre",
                }}
              >
                {r}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", width: 120, height: GAPS.rule, marginTop: GAPS.titleToRule, marginBottom: GAPS.ruleToPoem, background: look.accent }} />
        <PoemRows layout={layout} look={look} />
        {layout.more && (
          <div
            style={{
              display: "flex",
              marginTop: GAPS.poemToMore,
              height: GAPS.more * GAPS.moreLineHeight,
              fontSize: GAPS.more,
              color: look.accent,
              fontStyle: "italic",
              fontFamily: ogFontFamily(layout.more),
              whiteSpace: "pre",
            }}
          >
            {layout.more}
          </div>
        )}
      </div>

      {/* Byline, a hairline, then InkBoard's mark and the poem's (short) address. */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", height: byline.height }}>
          {avatar && (
            // eslint-disable-next-line @next/next/no-img-element -- Satori, not the DOM
            <img src={avatar} width={BYLINE.avatar} height={BYLINE.avatar} style={{ borderRadius: 999 }} alt="" />
          )}
          <div style={{ display: "flex", flexDirection: "column", marginLeft: avatar ? BYLINE.gap : 0 }}>
            <div
              style={{
                display: "flex",
                fontSize: BYLINE.name,
                lineHeight: `${BYLINE.name * BYLINE.nameLineHeight}px`,
                fontFamily: family(byline.extendedFirst),
                whiteSpace: "pre",
              }}
            >
              {byline.penName}
            </div>
            {byline.language && (
              <div
                style={{
                  display: "flex",
                  fontSize: BYLINE.language,
                  lineHeight: `${BYLINE.language * BYLINE.languageLineHeight}px`,
                  color: look.muted,
                  fontFamily: ogFontFamily(byline.language),
                  whiteSpace: "pre",
                }}
              >
                {`in ${byline.language}`}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", height: GAPS.divider, background: look.divider, marginTop: GAPS.footerGap, marginBottom: GAPS.footerGap }} />
        <div style={{ display: "flex", alignItems: "center", height: address.height }}>
          <LogoMark size={ADDRESS.logo} tile={look.logo.tile} glyph={look.logo.glyph} />
          <div style={{ display: "flex", flexDirection: "column", marginLeft: ADDRESS.gap }}>
            <div
              style={{
                display: "flex",
                fontSize: ADDRESS.host,
                lineHeight: `${ADDRESS.host * ADDRESS.hostLineHeight}px`,
                fontFamily: family(address.hostExtended),
                whiteSpace: "pre",
              }}
            >
              {address.host}
            </div>
            {address.pathRows.map((r, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  fontSize: ADDRESS.path,
                  lineHeight: `${ADDRESS.path * ADDRESS.pathLineHeight}px`,
                  color: look.muted,
                  fontFamily: family(address.pathExtended),
                  whiteSpace: "pre",
                }}
              >
                {r}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
