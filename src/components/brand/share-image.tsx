import {
  ADDRESS,
  BYLINE,
  CONTENT_WIDTH,
  GAPS,
  MORE_TEXT,
  SHARE_FRAME,
  type PoemRow,
  type ShareImageLayout,
} from "@/lib/share-image/layout";
import { BRAND } from "@/lib/site";
import { LogoMark } from "./og-card";
import { fontFamilyList as family, ogFontFamily } from "./og-type";

/*
 * The "Share as image" picture (docs/PLAN.md, Phase 21): the "Page" design at
 * 1080×1920, drawn by Satori (next/og) from a layout computed and measured in
 * src/lib/share-image/layout.ts. Every row is placed here with an explicit
 * height and `whiteSpace: "pre"`, so Satori never re-wraps anything and the
 * picture can't outgrow the safe area. Fonts: ogFontFamily (og-type.ts), so
 * Ghanaian letters and tone marks are set in Gentium Book Plus first.
 */

const RULE = "#e4dbcd";

function PoemRows({ layout }: { layout: ShareImageLayout }) {
  const { poem } = layout;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: CONTENT_WIDTH,
        fontSize: poem.size,
        lineHeight: `${poem.rowHeight}px`,
        color: BRAND.ink,
        fontFamily: family(poem.extendedFirst, "text"),
      }}
    >
      {poem.rows.map((row, i) => (
        <Row key={i} row={row} rowHeight={poem.rowHeight} gapHeight={poem.gapHeight} />
      ))}
    </div>
  );
}

function Row({ row, rowHeight, gapHeight }: { row: PoemRow; rowHeight: number; gapHeight: number }) {
  if (row.kind === "gap") return <div style={{ display: "flex", height: gapHeight }} />;
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

export function ShareImage({ layout, avatar }: { layout: ShareImageLayout; avatar: string | null }) {
  const { title, byline, address } = layout;
  return (
    <div
      style={{
        width: SHARE_FRAME.width,
        height: SHARE_FRAME.height,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: BRAND.paper,
        color: BRAND.ink,
        fontFamily: ogFontFamily(""),
        paddingTop: SHARE_FRAME.safeTop,
        paddingBottom: SHARE_FRAME.safeBottom,
        paddingLeft: SHARE_FRAME.side,
        paddingRight: SHARE_FRAME.side,
      }}
    >
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
        <div style={{ display: "flex", width: 120, height: GAPS.rule, marginTop: GAPS.titleToRule, marginBottom: GAPS.ruleToPoem, background: BRAND.primary }} />
        <PoemRows layout={layout} />
        {layout.poem.truncated && (
          <div
            style={{
              display: "flex",
              marginTop: GAPS.poemToMore,
              height: GAPS.more * GAPS.moreLineHeight,
              fontSize: GAPS.more,
              color: BRAND.primary,
              fontStyle: "italic",
              fontFamily: ogFontFamily(MORE_TEXT),
              whiteSpace: "pre",
            }}
          >
            {MORE_TEXT}
          </div>
        )}
      </div>

      {/* Byline, a hairline, then InkBoard's mark and the poem's address. */}
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
                  color: BRAND.muted,
                  fontFamily: ogFontFamily(byline.language),
                  whiteSpace: "pre",
                }}
              >
                {`in ${byline.language}`}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", height: GAPS.divider, background: RULE, marginTop: GAPS.footerGap, marginBottom: GAPS.footerGap }} />
        <div style={{ display: "flex", alignItems: "center", height: address.height }}>
          <LogoMark size={ADDRESS.logo} />
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
                  color: BRAND.muted,
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
