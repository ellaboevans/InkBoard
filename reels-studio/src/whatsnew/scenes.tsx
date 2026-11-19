import React from "react";
import { Easing, Img, interpolate, spring, staticFile, useCurrentFrame } from "remotion";
import { Paper } from "../components/Stage";
import { C, MONO, SANS, SERIF } from "../theme";
import { Corners } from "./components/Stage";
import { Device, Picture, type Layer } from "./components/Device";
import feed from "./data/feed-excerpt.json";
import { FPS } from "./theme";
import { E, f, T, TW } from "./timeline";

const cap = (src: string, at: number, enter?: Layer["enter"], dur?: number): Layer => ({ src, at, enter, dur });
const spr = (frame: number, at: number, config = { damping: 14, stiffness: 180 }) => spring({ frame: frame - f(at), fps: FPS, config });
const SITE = "tryinkboard.elabo.me";

/** Whichever value's time has come (for a card's address or a label). */
function useAt<T>(items: [number, T][]): T {
  const frame = useCurrentFrame();
  return [...items].reverse().find(([at]) => frame >= f(at))?.[1] ?? items[0][1];
}

/** A small label card that pops when its text changes (the Reel's tags, at this frame rate). */
export function Tag({ items, dark = false }: { items: [number, string][]; dark?: boolean }) {
  const frame = useCurrentFrame();
  const cur = [...items].reverse().find(([at]) => frame >= f(at));
  if (!cur) return null;
  const k = spr(frame, cur[0], { damping: 16, stiffness: 260 });
  return (
    <div
      style={{
        position: "absolute",
        left: 60,
        top: 74,
        transformOrigin: "0 50%",
        transform: `scale(${0.88 + 0.12 * k})`,
        opacity: Math.min(1, k * 1.6),
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px 8px 12px",
        borderRadius: 10,
        background: dark ? "rgba(19,34,53,.92)" : "rgba(253,250,244,.95)",
        border: dark ? "1.5px solid rgba(160,200,240,.5)" : "1.5px solid rgba(38,29,23,.15)",
        boxShadow: "0 8px 20px rgba(38,29,23,.12)",
        fontFamily: MONO,
        fontSize: 17,
        letterSpacing: 1.4,
        color: dark ? C.blueprintInk : C.ink,
        whiteSpace: "nowrap",
      }}
    >
      <div style={{ width: 5, alignSelf: "stretch", borderRadius: 3, background: dark ? "#7fb6ef" : C.red }} />
      {cur[1]}
    </div>
  );
}

function Chip({ at, text, x, y }: { at: number; text: string; x: number; y: number }) {
  const frame = useCurrentFrame();
  if (frame < f(at)) return null;
  const k = spr(frame, at, { damping: 15, stiffness: 240 });
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: `translate(-50%, 0) translateY(${(1 - k) * 20}px) scale(${0.9 + 0.1 * k})`, opacity: Math.min(1, k * 2), display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", borderRadius: 999, background: C.paper, border: "1.5px solid rgba(38,29,23,.16)", boxShadow: "0 10px 24px rgba(38,29,23,.16)", fontFamily: MONO, fontSize: 22, color: C.ink, whiteSpace: "nowrap" }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
      {text}
    </div>
  );
}

/* ------------------------------------------------------------- cold open */

export function ColdOpen() {
  const frame = useCurrentFrame();
  const title = spr(frame, T("title") - 0.15, { damping: 16, stiffness: 170 });
  const devOut = T("title") - 0.25;
  return (
    <>
      <Paper />
      <Picture src="pic-ndi-ink.png" at={T("cold-1")} w={300} ratio={16 / 9} cx={640} cy={500} rot={-7} out={T("cold-2") - 0.15} from={[960, 640]} />
      <Picture src="pic-story-page.png" at={T("cold-1") + 0.12} w={320} ratio={16 / 9} cx={960} cy={480} out={T("cold-2") - 0.15} from={[960, 640]} />
      <Picture src="pic-chat-board.png" at={T("cold-1") + 0.24} w={380} ratio={1.25} cx={1290} cy={500} rot={7} out={T("cold-2") - 0.15} from={[960, 640]} />
      <Device
        kind="browser"
        url={useAt([[0, `${SITE}/a/abla-dzifa`], [TW("cold-2", 2), `${SITE}/a/odalys-moon/n/the-ferry-at-yeji`], [T("cold-3") - 0.1, `${SITE}/admin/stats`]])}
        layers={[cap("photo-author.png", 0), cap("read-novel.png", TW("cold-2", 2), "fade", 0.2), cap("stats-0.png", T("cold-3") - 0.1, "slideLeft", 0.3)]}
        pose={[
          { at: 0, snap: true, o: 0, s: 0.9, y: 40 },
          { at: T("cold-2") - 0.1, o: 1, s: 1, y: 0 },
          { at: devOut, o: -0.2, s: 0.94, config: { damping: 30, stiffness: 220 } },
        ]}
        cam={[
          { at: T("cold-2"), z: 1.3, fx: 700, fy: 220, ay: 460 },
          { at: TW("cold-2", 2), z: 1.15, fx: 560, fy: 240 },
          { at: T("cold-3") - 0.1, z: 1.6, fx: 844, fy: 309, ax: 960, ay: 470 },
        ]}
      />
      {frame >= f(T("title") - 0.3) && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28, paddingBottom: 90 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 26, opacity: title, transform: `translateY(${(1 - title) * 30}px)` }}>
            <Img src={staticFile("feather-tile.svg")} style={{ width: 104, height: 104 }} />
            <div style={{ fontFamily: SERIF, fontSize: 104, fontWeight: 600, color: C.ink, letterSpacing: -1.5 }}>What&apos;s new in InkBoard</div>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 22, letterSpacing: 4, color: C.muted, opacity: spr(frame, T("title") + 0.25) }}>SINCE THE LAST WALKTHROUGH · EIGHT CHAPTERS</div>
        </div>
      )}
      <Corners right="Cold open" />
    </>
  );
}

/* ------------------------------------------------------------- 1 · share a poem as an image */

export function ShareSection() {
  const t0 = T("s1") - 0.4;
  const choose = T("s4") + 0.9;
  return (
    <>
      <Paper drift={200} />
      <Device
        kind="phone"
        cx={700}
        layers={[
          cap("sh-poem.png", t0),
          cap("sh-0.png", T("s1") + 1.9, "slideUp", 0.35),
          cap("sh-ink.png", TW("s2", 4) + 0.05, "fade", 0.15),
          cap("sh-board.png", TW("s2", 6) + 0.05, "fade", 0.15),
          cap("sh-chat.png", TW("s3", 6) + 0.05, "fade", 0.15),
          cap("sh-choose.png", choose + 0.05, "fade", 0.15),
          cap("sh-lines-2.png", choose + 1.3, "fade", 0.12),
          cap("sh-lines-pic.png", choose + 2.0, "fade", 0.2),
        ]}
        taps={[
          { at: T("s1") + 1.7, x: 102, y: 228 },
          { at: TW("s2", 4), x: 195, y: 430 },
          { at: TW("s2", 6), x: 300, y: 430 },
          { at: TW("s3", 6), x: 273, y: 524 },
          { at: choose, x: 273, y: 618 },
          { at: choose + 0.75, x: 59, y: 739 },
          { at: choose + 1.25, x: 59, y: 783 },
        ]}
        cam={[
          { at: T("s1") + 2.1, z: 1.22, fx: 195, fy: 330, ay: 500 },
          { at: TW("s3", 6) - 0.2, fy: 420 },
          { at: choose - 0.1, z: 1.3, fy: 640, ay: 560 },
          { at: choose + 1.9, z: 1.22, fy: 300, ay: 500 },
        ]}
      />
      <Picture src="pic-story-ink.png" at={T("s3")} w={300} ratio={16 / 9} cx={1330} cy={520} rot={3} out={TW("s3", 6)} from={[900, 560]} />
      <Picture src="pic-chat-board.png" at={TW("s3", 6) + 0.1} w={420} ratio={1.25} cx={1330} cy={500} rot={2} out={choose + 2.0} from={[900, 560]} />
      <Picture src="pic-chat-lines.png" at={choose + 2.05} w={420} ratio={1.25} cx={1330} cy={480} rot={-1} from={[900, 560]} />
      <Chip at={T("s5") + 0.5} text={`${SITE}/s/q96hkq`} x={1330} y={780} />
      <Corners right="01 · Share a poem as an image" />
      <Tag
        items={[
          [t0, "SHARE AS IMAGE"],
          [TW("s2", 2), "DESIGN · PAGE"],
          [TW("s2", 4), "DESIGN · INK"],
          [TW("s2", 6), "DESIGN · BOARD"],
          [T("s3"), "SIZE · STATUS OR STORY 9:16"],
          [TW("s3", 6), "SIZE · CHAT 4:5"],
          [choose, "LINES · PICK UP TO 12"],
          [choose + 1.3, "LINES · 2 OF 12 PICKED"],
          [T("s5"), "SHORT LINK · /s/q96hkq"],
        ]}
      />
    </>
  );
}

/* ------------------------------------------------------------- 2 · profile photos */

export function PhotoSection() {
  const open = TW("p1", 6) + 0.2;
  const save = E("p2") - 0.15;
  return (
    <>
      <Paper drift={400} />
      <Device
        kind="browser"
        url={useAt([[0, `${SITE}/admin/profile`], [T("p3"), `${SITE}/`], [TW("p3", 8), `${SITE}/a/abla-dzifa`]])}
        layers={[
          cap("photo-0.png", T("p1") - 0.5),
          cap("photo-crop-0.png", open + 0.15, "fade", 0.2),
          cap("photo-crop-1.png", T("p2") + 1.0, "fade", 0.25),
          cap("photo-crop-2.png", T("p2") + 1.8, "fade", 0.25),
          cap("photo-saved.png", save + 0.2, "fade", 0.25),
          cap("photo-board.png", T("p3"), "slideLeft", 0.35),
          cap("photo-author.png", TW("p3", 8), "slideLeft", 0.35),
        ]}
        cursor={[
          { at: T("p1"), x: 900, y: 640 },
          { at: open, x: 489, y: 473, click: true },
          { at: T("p2") + 0.4, x: 612, y: 462 },
          { at: T("p2") + 1.0, x: 700, y: 462 },
          { at: T("p2") + 1.6, x: 640, y: 513 },
          { at: save, x: 910, y: 806, click: true },
          { at: save + 0.6, x: 1000, y: 700 },
        ]}
        cam={[
          { at: T("p1") + 0.1, z: 1.45, fx: 843, fy: 330, ay: 480 },
          { at: open + 0.2, z: 1.45, fx: 720, fy: 470, ay: 520 },
          { at: save + 0.3, z: 1.45, fx: 843, fy: 300, ay: 480 },
          { at: T("p3"), z: 1.55, fx: 720, fy: 470, ay: 530 },
          { at: TW("p3", 8), z: 1.45, fx: 760, fy: 300, ay: 470 },
        ]}
      />
      <Corners right="02 · Profile photos" />
      <Tag items={[[T("p1") - 0.5, "PROFILE · UPLOAD PHOTO"], [open, "CROP · INSIDE THE CIRCLE"], [save, "PHOTO SAVED"], [T("p3"), "ON THE BOARD"], [TW("p3", 8), "ON THE AUTHOR PAGE"]]} />
    </>
  );
}

/* ------------------------------------------------------------- 3 · follow an author */

function LockScreen({ at, update }: { at: number; update: number }) {
  const frame = useCurrentFrame();
  const k = spr(frame, at, { damping: 15, stiffness: 200 });
  const u = interpolate(frame, [f(update), f(update) + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const bump = frame >= f(update) ? 1 + 0.03 * Math.sin(Math.min(1, (frame - f(update)) / 8) * Math.PI) : 1;
  const text = (title: string, body: string, o: number) => (
    <div style={{ position: "absolute", left: 54, right: 0, top: 0, opacity: o }}>
      <div style={{ fontSize: 15.5, fontWeight: 650, marginTop: 20, lineHeight: 1.25 }}>{title}</div>
      <div style={{ fontSize: 15, marginTop: 2 }}>{body}</div>
    </div>
  );
  return (
    <div style={{ position: "absolute", inset: 0, background: "#1b1511", backgroundImage: "radial-gradient(circle, rgba(216,208,195,.13) 1.3px, transparent 1.6px)", backgroundSize: "19px 19px", fontFamily: SANS, color: C.paper }}>
      <div style={{ position: "absolute", top: 70, width: "100%", textAlign: "center", fontSize: 17, fontWeight: 500, opacity: 0.85 }}>Thursday 19 November</div>
      <div style={{ position: "absolute", top: 88, width: "100%", textAlign: "center", fontSize: 92, fontWeight: 300, letterSpacing: -2 }}>7:24</div>
      <div style={{ position: "absolute", left: 12, right: 12, top: 250, height: 92, padding: "13px 14px", borderRadius: 22, background: "rgba(253,250,244,.95)", color: C.ink, transform: `translateY(${(1 - k) * -260}px) scale(${(0.92 + 0.08 * k) * bump})`, opacity: Math.min(1, k * 2), boxShadow: "0 10px 30px rgba(0,0,0,.4)", boxSizing: "border-box" }}>
        <Img src={staticFile("feather-tile.svg")} style={{ position: "absolute", left: 14, top: 14, width: 40, height: 40, borderRadius: 10 }} />
        <div style={{ position: "absolute", left: 68, right: 14, top: 12, display: "flex", justifyContent: "space-between", fontSize: 13.5, color: C.muted }}>
          <span style={{ fontWeight: 600, color: C.ink }}>InkBoard</span>
          <span>{u > 0.5 ? "now" : "now"}</span>
        </div>
        <div style={{ position: "absolute", left: 14, right: 14, top: 12 }}>
          {text("New chapter: Harmattan Mornings, Chapter 1", "By Abla Dzifa", 1 - u)}
          {text("2 new from Abla Dzifa", "Latest: Dust Season", u)}
        </div>
      </div>
      <div style={{ position: "absolute", bottom: 10, left: "50%", width: 134, height: 5, marginLeft: -67, borderRadius: 3, background: "rgba(253,250,244,.8)" }} />
    </div>
  );
}

export function FollowSection() {
  const click = TW("f1", 3);
  const phoneIn = T("f2") - 0.1;
  return (
    <>
      <Paper drift={600} />
      <Device
        kind="browser"
        url={`${SITE}/a/abla-dzifa`}
        layers={[cap("follow-0.png", T("f1") - 0.6), cap("follow-1.png", click + 0.12, "fade", 0.15)]}
        cursor={[{ at: T("f1"), x: 900, y: 520 }, { at: click, x: 512, y: 300, click: true }, { at: click + 0.7, x: 560, y: 420 }]}
        cam={[{ at: T("f1") - 0.2, z: 1.6, fx: 700, fy: 300, ay: 470 }, { at: phoneIn, z: 1.0, fx: 720, fy: 450, ax: 960, ay: 552 }]}
        pose={[{ at: phoneIn, x: -330, s: 0.7, config: { damping: 18, stiffness: 160 } }]}
      />
      <Device
        kind="phone"
        dark
        cx={1380}
        layers={[{ node: <LockScreen at={TW("f2", 8)} update={TW("f3", 4)} />, at: 0 }]}
        pose={[{ at: 0, snap: true, y: 1100, rz: 6 }, { at: phoneIn, y: 0, rz: 2 }]}
        cam={[{ at: TW("f2", 8) - 0.1, z: 1.25, fx: 195, fy: 300, ax: 1380, ay: 480 }]}
      />
      <Corners right="03 · Follow an author" />
      <Tag items={[[T("f1") - 0.6, "AUTHOR PAGE · ABLA DZIFA"], [click, "FOLLOWING · NEW POEMS AND CHAPTERS"], [TW("f2", 8), "NOTIFICATION · NEW CHAPTER"], [TW("f3", 4), "SAME NOTIFICATION · QUIET UPDATE"]]} />
    </>
  );
}

/* ------------------------------------------------------------- 4 · novels for writers */

export function WritersSection() {
  const w1 = T("w1");
  const create = T("w3") + 0.1;
  const upload = TW("w3", 3);
  const coverSave = E("w3") - 0.1;
  const chapter = T("w4") - 0.2;
  const drop = TW("w4", 6);
  const preview = TW("w4", 11);
  const publish = TW("w5", 1);
  const orderAt = TW("w5", 7) - 0.3;
  const move = E("w5") - 0.3;
  return (
    <>
      <Paper drift={800} />
      <Device
        kind="browser"
        url={useAt([[0, `${SITE}/admin/novels`], [create + 0.2, `${SITE}/admin/novels/harmattan-mornings`], [chapter + 0.3, `${SITE}/admin/novels/harmattan-mornings/chapters/dust`], [orderAt, `${SITE}/admin/novels/harmattan-mornings`]])}
        layers={[
          cap("nadmin-0.png", w1 - 0.6),
          cap("nadmin-dialog-0.png", w1 + 0.45, "fade", 0.2),
          cap("nadmin-dialog-1.png", TW("w1", 4), "fade", 0.25),
          cap("nadmin-dialog-lang.png", TW("w1", 7) + 0.05, "fade", 0.12),
          cap("nadmin-dialog-status.png", TW("w1", 10) + 0.05, "fade", 0.12),
          cap("nadmin-dialog-2.png", E("w1") + 0.1, "fade", 0.15),
          cap("nadmin-novel-0.png", create + 0.2, "fade", 0.25),
          cap("nadmin-crop.png", upload + 0.15, "fade", 0.2),
          cap("nadmin-novel-1.png", coverSave + 0.2, "fade", 0.2),
          cap("chapter-ed-0.png", chapter + 0.3, "slideLeft", 0.35),
          cap("chapter-ed-1.png", chapter + 0.9, "fade", 0.3),
          cap("chapter-ed-2.png", drop + 0.1, "fade", 0.12),
          cap("chapter-ed-preview.png", preview + 0.1, "fade", 0.2),
          cap("chapter-ed-3.png", T("w5") - 0.1, "fade", 0.2),
          cap("chapter-ed-published.png", publish + 0.15, "fade", 0.2),
          cap("order-0.png", orderAt, "slideLeft", 0.35),
          cap("order-1.png", move + 0.2, "fade", 0.25),
        ]}
        cursor={[
          { at: w1 - 0.3, x: 900, y: 600 },
          { at: w1 + 0.3, x: 516, y: 386, click: true },
          { at: TW("w1", 7), x: 596, y: 572, click: true },
          { at: TW("w1", 10), x: 844, y: 572, click: true },
          { at: E("w1"), x: 700, y: 620 },
          { at: T("w2") + 0.3, x: 980, y: 470 },
          { at: create, x: 907, y: 674, click: true },
          { at: upload, x: 565, y: 756, click: true },
          { at: coverSave, x: 911, y: 863, click: true },
          { at: chapter, x: 545, y: 475, click: true },
          { at: drop, x: 785, y: 300, click: true },
          { at: preview, x: 1183, y: 300, click: true },
          { at: publish, x: 1166, y: 872, click: true },
          { at: orderAt + 0.5, x: 1000, y: 560 },
          { at: move, x: 1152, y: 529, click: true },
          { at: move + 0.6, x: 1250, y: 600 },
        ]}
        cam={[
          { at: w1 + 0.55, z: 1.5, fx: 720, fy: 500, ay: 500 },
          { at: TW("w1", 7) - 0.15, z: 1.75, fx: 720, fy: 560, ay: 500 },
          { at: T("w2") - 0.1, z: 2.1, fx: 720, fy: 462, ay: 470 },
          { at: create + 0.1, z: 1.3, fx: 720, fy: 460, ay: 520 },
          { at: upload + 0.25, z: 1.45, fx: 720, fy: 470, ay: 500 },
          { at: coverSave + 0.25, z: 1.4, fx: 760, fy: 720, ay: 560 },
          { at: chapter + 0.35, z: 1.45, fx: 844, fy: 380, ay: 500 },
          { at: preview + 0.15, z: 1.6, fx: 800, fy: 420, ay: 480 },
          { at: T("w5") - 0.15, z: 1.15, fx: 720, fy: 330, ay: 520 },
          { at: orderAt + 0.1, z: 1.35, fx: 844, fy: 430, ay: 500 },
        ]}
      />
      <Corners right="04 · Novels for writers" />
      <Tag
        items={[
          [w1 - 0.6, "NOVELS"],
          [w1 + 0.45, "NEW NOVEL · TITLE, LANGUAGE, STATUS"],
          [T("w2"), "BLURB · LIKE A BOOK'S BACK COVER"],
          [upload, "COVER · CROPPED TO 2:3"],
          [chapter + 0.3, "CHAPTER EDITOR"],
          [drop, "DROP CAP"],
          [publish, "CHAPTER PUBLISHED"],
          [orderAt, "CHAPTERS, IN READING ORDER"],
        ]}
      />
    </>
  );
}

/* ------------------------------------------------------------- 5 · novels for readers */

function FeedCard({ at }: { at: number }) {
  const frame = useCurrentFrame();
  if (frame < f(at)) return null;
  const k = spr(frame, at, { damping: 16, stiffness: 170 });
  return (
    <div style={{ position: "absolute", left: 1010, top: 210, width: 860, padding: "26px 30px", borderRadius: 18, background: "#1d1712", boxShadow: "0 30px 70px rgba(20,12,8,.45), 0 0 0 1.5px rgba(255,255,255,.1)", transform: `translateX(${(1 - k) * 220}px) rotate(${1.5 * k}deg)`, opacity: Math.min(1, k * 2) }}>
      <div style={{ fontFamily: MONO, fontSize: 15, letterSpacing: 2, color: "#d9a679", marginBottom: 14 }}>/a/odalys-moon/n/the-ferry-at-yeji/feed.xml · ATOM</div>
      {(feed as string[]).slice(0, 26).map((l, i) => (
        <div key={i} style={{ fontFamily: MONO, fontSize: 14.5, lineHeight: "21px", whiteSpace: "pre", color: /<title/.test(l) ? "#fdf3e2" : /<entry|<\/entry/.test(l) ? "#d9a679" : "rgba(253,243,226,.62)" }}>
          {l}
        </div>
      ))}
    </div>
  );
}

export function ReadersSection() {
  const phoneAt = T("r5") - 0.2;
  const back = T("r6") - 0.3;
  const save = TW("r7", 1);
  const feedAt = TW("r7", 8);
  return (
    <>
      <Paper drift={1000} />
      <Device
        kind="browser"
        url={useAt([[0, `${SITE}/`], [T("r2"), `${SITE}/a/odalys-moon/n/the-ferry-at-yeji`], [T("r3"), `${SITE}/a/odalys-moon/n/the-ferry-at-yeji/thursday`], [T("r4"), `${SITE}/a/amara-nwosu-bell/n/vu-la-fe-ngko/ngdi-kanyaa`], [back, `${SITE}/a/odalys-moon/n/the-ferry-at-yeji`]])}
        layers={[
          cap("read-board.png", T("r1") - 0.6),
          cap("read-novel.png", T("r2"), "slideLeft", 0.35),
          cap("read-chapter.png", T("r3"), "slideLeft", 0.35),
          cap("read-ewe.png", T("r4"), "slideLeft", 0.35),
          cap("read-continue.png", back, "cut"),
          cap("read-saving.png", save + 0.15, "fade", 0.12),
          cap("read-saved.png", save + 1.75, "fade", 0.2),
        ]}
        cursor={[
          { at: back + 0.2, x: 1000, y: 600 },
          { at: TW("r6", 6), x: 620, y: 406 },
          { at: save, x: 1103, y: 506, click: true },
          { at: feedAt - 0.1, x: 347, y: 844 },
        ]}
        cam={[
          { at: T("r1") - 0.3, z: 1.55, fx: 520, fy: 330, ay: 520 },
          { at: T("r2") + 0.1, z: 1.2, fx: 720, fy: 300, ay: 470 },
          { at: T("r3") + 0.1, z: 1.7, fx: 720, fy: 330, ay: 490 },
          { at: T("r4") + 0.1, z: 1.7, fx: 720, fy: 690, ay: 520 },
          { at: back, snap: true, z: 1.2, fx: 720, fy: 380, ay: 500 },
          { at: TW("r6", 4), z: 1.6, fx: 720, fy: 380, ay: 500 },
          { at: save - 0.25, z: 1.45, fx: 900, fy: 520, ay: 520 },
          { at: feedAt - 0.2, z: 1.0, fx: 720, fy: 450 },
        ]}
        pose={[
          { at: phoneAt, o: -0.2, s: 0.94, config: { damping: 30, stiffness: 220 } },
          { at: back, snap: true, o: 1, s: 1 },
          { at: feedAt - 0.2, x: -260, s: 0.86, config: { damping: 18, stiffness: 160 } },
        ]}
      />
      <Device
        kind="phone"
        layers={[cap("ts-0.png", phoneAt), cap("ts-1.png", TW("r5", 3) + 0.1, "fade", 0.15), cap("ts-2.png", TW("r5", 7) + 0.05, "fade", 0.15), cap("ts-3.png", TW("r5", 10) + 0.05, "fade", 0.15)]}
        taps={[{ at: TW("r5", 3), x: 365, y: 26 }, { at: TW("r5", 7), x: 260, y: 112 }, { at: TW("r5", 10), x: 300, y: 210 }]}
        pose={[{ at: 0, snap: true, o: 0, y: 700 }, { at: phoneAt, o: 1, y: 0, config: { damping: 16, stiffness: 170 } }, { at: back - 0.25, o: -0.2, y: 300, config: { damping: 30, stiffness: 220 } }]}
        cam={[{ at: phoneAt + 0.1, z: 1.25, fx: 195, fy: 380, ay: 520 }, { at: TW("r5", 3) - 0.2, z: 1.55, fx: 195, fy: 250, ay: 480 }]}
      />
      <FeedCard at={feedAt} />
      <Corners right="05 · Novels for readers" />
      <Tag
        items={[
          [T("r1") - 0.6, "BOOK CARDS ON THE BOARD"],
          [T("r2"), "THE NOVEL PAGE"],
          [T("r3"), "CHAPTER 1 · DROP CAP"],
          [T("r4"), "EWE · Ʋu la ƒe Ŋkɔ"],
          [phoneAt, "TEXT SETTINGS"],
          [TW("r5", 7), "TEXT SIZE · LARGER"],
          [TW("r5", 10), "FONT · SANS"],
          [back, "CONTINUE · CHAPTER 2"],
          [save, "SAVE THIS NOVEL FOR OFFLINE"],
          [feedAt, "THE NOVEL'S OWN FEED"],
        ]}
      />
    </>
  );
}

/* ------------------------------------------------------------- 6 · private novels */

export function PrivateSection() {
  const form = T("v3") - 0.1;
  const field = form + 0.4;
  const unlock = TW("v3", 3);
  const next = E("v3") + 0.4;
  return (
    <>
      <Paper drift={1200} />
      <Device
        kind="browser"
        url={useAt([[0, `${SITE}/a/ines-calloway/n/letters-to-the-lighthouse-keeper`], [form, `${SITE}/a/ines-calloway/n/letters-to-the-lighthouse-keeper/the-first-letter`], [next, `${SITE}/a/ines-calloway/n/letters-to-the-lighthouse-keeper/his-reply`]])}
        layers={[
          cap("priv-novel.png", T("v1") - 0.6),
          cap("priv-0.png", form, "slideLeft", 0.35),
          cap("priv-1.png", field + 0.35, "cut"),
          cap("priv-open.png", unlock + 0.2, "reveal", 0.45),
          cap("priv-next.png", next, "slideLeft", 0.35),
        ]}
        cursor={[{ at: form + 0.1, x: 1000, y: 600 }, { at: field, x: 700, y: 456, click: true }, { at: unlock, x: 720, y: 500, click: true }, { at: unlock + 0.6, x: 900, y: 640 }]}
        cam={[
          { at: T("v1") + 0.1, z: 1.6, fx: 780, fy: 250, ay: 460 },
          { at: T("v2"), z: 1.2, fx: 720, fy: 400, ay: 480 },
          { at: form + 0.1, z: 1.45, fx: 720, fy: 460, ay: 500 },
          { at: unlock + 0.3, z: 1.3, fx: 720, fy: 420, ay: 500 },
        ]}
      />
      <Corners right="06 · Private novels" />
      <Tag items={[[T("v1") - 0.6, "PRIVATE NOVEL · ONE PASSWORD"], [T("v2"), "TITLE, COVER AND CHAPTERS STAY VISIBLE"], [form, "UNLOCK ONCE"], [next, "CHAPTER 2 · ALREADY OPEN"]]} />
    </>
  );
}

/* ------------------------------------------------------------- 7 · share a passage */

export function PassageSection() {
  const t1 = TW("q1", 7);
  const start = T("q2") + 0.4;
  return (
    <>
      <Paper drift={1400} />
      <Device
        kind="phone"
        cx={700}
        layers={[
          cap("pas-0.png", T("q1") - 0.6),
          cap("pas-1.png", t1 + 0.05, "fade", 0.12),
          cap("pas-2.png", t1 + 1.25, "fade", 0.2),
          cap("pas-3.png", T("q2") - 0.1, "fade", 0.2),
          cap("pas-start-open.png", start + 0.1, "fade", 0.12),
          cap("pas-4.png", start + 0.9, "fade", 0.15),
          cap("pas-end-open.png", start + 1.6, "fade", 0.12),
          cap("pas-4.png", start + 2.3, "fade", 0.12),
          cap("pas-5.png", T("q4") - 0.1, "slideUp", 0.35),
        ]}
        taps={[
          { at: t1, x: 59, y: 729 },
          { at: t1 + 0.5, x: 59, y: 817 },
          { at: t1 + 1.0, x: 59, y: 929 },
          { at: start, x: 195, y: 540 },
          { at: start + 0.8, x: 195, y: 600 },
          { at: start + 1.5, x: 195, y: 622 },
        ]}
        cam={[
          { at: T("q1") - 0.2, z: 1.25, fx: 195, fy: 700, ay: 560 },
          { at: t1 + 1.25, fy: 400 },
          { at: T("q2") - 0.1, z: 1.3, fy: 520, ay: 540 },
          { at: T("q3") - 0.1, z: 2.1, fx: 150, fy: 166, ay: 470 },
          { at: T("q4") - 0.1, z: 1.0, fx: 195, fy: 422 },
        ]}
      />
      <Picture src="pic-passage.png" at={T("q4") + 0.5} w={330} ratio={16 / 9} cx={1330} cy={520} rot={2} from={[900, 560]} />
      <Chip at={T("q4") + 1.2} text={`${SITE}/s/9m5hkp`} x={1330} y={846} />
      <Corners right="07 · Share a passage" />
      <Tag
        items={[
          [T("q1") - 0.6, "SHARE A PASSAGE"],
          [t1, "PARAGRAPH 1"],
          [t1 + 1.0, "PARAGRAPHS 1 – 3"],
          [start, "START AT · SENTENCE 2"],
          [start + 1.5, "END AFTER"],
          [T("q3"), "395 OF 600 CHARACTERS"],
          [T("q4"), "THE PICTURE · STORY 9:16"],
        ]}
      />
    </>
  );
}

/* ------------------------------------------------------------- 8 · stats */

export function StatsSection() {
  return (
    <>
      <Paper drift={1600} />
      <Device
        kind="browser"
        url={`${SITE}/admin/stats`}
        layers={[cap("stats-0.png", T("t1") - 0.6), { src: "stats-1.png", at: T("t2") - 0.1, enter: { scroll: 396 }, dur: 0.5 }, { src: "stats-2.png", at: T("t3") - 0.1, enter: { scroll: 298 }, dur: 0.5 }]}
        cam={[
          { at: T("t1") - 0.3, z: 1.6, fx: 844, fy: 300, ay: 470 },
          { at: T("t2") - 0.1, z: 1.4, fx: 844, fy: 360, ay: 500 },
          { at: T("t3") - 0.1, z: 1.6, fx: 844, fy: 770, ay: 500 },
          { at: T("t4"), z: 1.25, fx: 844, fy: 640, ay: 500 },
          { at: TW("t4", 4), z: 1.7, fx: 844, fy: 690, ay: 470 },
        ]}
      />
      <Corners right="08 · Stats for writers" />
      <Tag items={[[T("t1") - 0.6, "FOLLOWERS · DEVICES, NOT PEOPLE"], [T("t2"), "SHARED LINKS · VISITS"], [T("t3"), "NOVELS · WORDS AND READING TIME"], [T("t4"), "NO PAGE VIEWS · NO TRACKING"]]} />
    </>
  );
}

/* ------------------------------------------------------------- ending */

export function Ending() {
  const frame = useCurrentFrame();
  const a = spr(frame, T("end"), { damping: 16, stiffness: 170 });
  const b = spr(frame, TW("end", 3), { damping: 14, stiffness: 180 });
  const c = spr(frame, TW("end", 7) + 0.1, { damping: 15, stiffness: 200 });
  return (
    <>
      <Paper drift={1800} />
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 40, paddingBottom: 120 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 30, opacity: a, transform: `translateY(${(1 - a) * 40}px)` }}>
          <Img src={staticFile("feather-tile.svg")} style={{ width: 132, height: 132 }} />
          <div style={{ fontFamily: SERIF, fontWeight: 650, fontSize: 150, letterSpacing: -2.5, color: C.ink, lineHeight: 1 }}>InkBoard</div>
        </div>
        <div style={{ padding: "18px 54px 20px", borderRadius: 999, background: C.red, color: C.onRed, textAlign: "center", boxShadow: "0 16px 36px rgba(133,46,44,.32)", transform: `scale(${0.7 + 0.3 * b})`, opacity: Math.min(1, b * 2) }}>
          <div style={{ fontFamily: SANS, fontWeight: 650, fontSize: 46, lineHeight: 1.1 }}>Start writing free</div>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 36, color: C.ink, letterSpacing: 1, opacity: Math.min(1, c * 2), transform: `translateY(${(1 - c) * 16}px)` }}>{SITE}</div>
      </div>
      <Corners right="Start writing free" />
    </>
  );
}

void Easing;
