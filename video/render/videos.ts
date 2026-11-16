/**
 * The two edits. Each video is a list of parts (rendered separately, then
 * joined); each part is a list of segments: title cards and clips of takes.
 * Captions on the walkthrough come from the takes themselves (written in the
 * scene scripts); the reel has its own, shorter ones.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { RENDERS, TAKES } from "../lib/config";
import { closeBrowser } from "../lib/recorder";
import { startProd, stopProd } from "../lib/servers";
import { captionTimeline, place, prepare, renderPart, type Format, type Segment } from "./compose";
import {
  closeOverlayPages,
  endCard16,
  endCardReel,
  fileCard,
  intro16,
  linkPreview,
  logoSvg,
  outro16,
  outroReel,
  readPalette,
  title16,
  titleReel,
} from "./overlays";

export type VideoName = "walkthrough" | "reel";
type Part = { name: string; build: (svg: string) => Segment[] };

const clip = (take: string, extra: Partial<Extract<Segment, { kind: "clip" }>> = {}): Segment => ({ kind: "clip", take, ...extra });
const chapter = (n: number, title: string, sub: string, format: Format = "wide"): Segment => ({
  kind: "card",
  overlay: format === "wide" ? title16(`Chapter ${n}`, title, sub) : titleReel(`Chapter ${n}`, title, sub),
  duration: 3.1,
  text: `Chapter ${n}: ${title}. ${sub}`,
});

export const OUTRO = ["More is on the way:", "follow us for updates."] as const;

function exportText() {
  const file = path.join(TAKES, "export", "export.md");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  return text.split("\n").slice(0, 24).join("\n");
}
function exportName() {
  const file = path.join(TAKES, "export", "export-name.txt");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "poems.md";
}

const WALKTHROUGH: Part[] = [
  {
    name: "intro-reading",
    build: (svg) => [
      {
        kind: "card",
        overlay: intro16(svg, "A public board of poems, in Ghanaian languages and English. Here's how it works."),
        duration: 3.8,
        text: "InkBoard: a public board of poems, in Ghanaian languages and English. Here's how it works.",
      },
      clip("board", { from: "in", to: "out" }),
      chapter(1, "Reading", "Wander the board, open a poem, unlock a private one, search, browse by language."),
      clip("overlay"),
      clip("private"),
      clip("search"),
      clip("language"),
      clip("author"),
    ],
  },
  {
    name: "follow-share-install",
    build: () => [
      chapter(2, "Follow, share, install", "Feeds, share cards, the app on your phone, and reading offline."),
      clip("feeds"),
      clip("share", {
        extras: [
          {
            overlay: linkPreview(path.join(TAKES, "share", "share-card.png"), "Sankɔfa by Ama Sɛwaa", "https://tryinkboard.elabo.me/p/ama-sewaa/sankofa", 760),
            from: "card",
            to: "card-out",
            x: 580,
            y: 150,
            width: 760,
          },
        ],
      }),
      clip("install"),
      clip("offline"),
    ],
  },
  {
    name: "writing",
    build: () => [
      chapter(3, "Writing", "Sign in with a code, write in Ewe, Akan, Ga or English, and publish."),
      clip("signup"),
      clip("write"),
      clip("private-poem"),
      clip("history"),
      clip("collections"),
      clip("profile"),
    ],
  },
  {
    name: "signing-in",
    build: () => [
      chapter(4, "Signing in without email", "Recovery codes, passkeys, and computers that aren't yours."),
      clip("recovery-passkey"),
      clip("public-device"),
      clip("inbox"),
    ],
  },
  {
    name: "account-outro",
    build: (svg) => [
      chapter(5, "Your account", "Download your poems, or delete everything."),
      clip("export", {
        extras: [{ overlay: fileCard(exportName(), exportText(), 760, 620), from: "file", to: "file-out", x: 580, y: 150, width: 760 }],
      }),
      clip("delete"),
      { kind: "card", overlay: outro16(OUTRO[0], OUTRO[1]), duration: 4.2, text: OUTRO.join(" ") },
      { kind: "card", overlay: endCard16(svg), duration: 4.0, text: "InkBoard · tryinkboard.elabo.me" },
    ],
  },
];

const REEL: Part[] = [
  {
    name: "reel",
    build: (svg) => [
      clip("phone-board", {
        from: "in",
        to: "read+1.5",
        // The poem opens in the lower half of the phone: bring it up into the safe area.
        camera: [{ at: "tap+0.9", rect: { x: 0, y: 380, width: 390, height: 440 } }],
        captions: [
          { at: "in", text: "Poems in Ewe, Twi, Ga and English, on one board." },
          { at: "pinched", text: "Drag, pinch, and tap one to read it." },
        ],
      }),
      clip("phone-language", { captions: [{ at: 0, text: "Browse by language: Ewe, Akan, Ga." }] }),
      clip("write", {
        from: "letters",
        to: "letters-end",
        captions: [
          { at: "letters", text: "Write with ɛ, ɔ, ɖ, ŋ and tone marks built in." },
        ],
      }),
      clip("write", { from: "publish", captions: [{ at: "publish", text: "Publish it to the board." }] }),
      clip("private", { from: "unlock", captions: [{ at: "unlock", text: "Or keep it private, behind a password." }] }),
      clip("install", { captions: [{ at: 0, text: "Put it on your home screen." }] }),
      clip("offline", { from: "offline", captions: [{ at: "offline", text: "Read offline, too." }] }),
      clip("recovery-passkey", {
        from: "passkey-signin-1",
        captions: [{ at: "passkey-signin-1", text: "Sign in with a passkey. No password." }],
        // Framed for a phone screen: the sign-in form, then the dashboard it opens.
        noCamera: true,
        camera: [
          { at: "passkey-signin-1", rect: { x: 40, y: 150, width: 560, height: 420 } },
          { at: "passkey-signin+1.2", rect: { x: 260, y: 0, width: 640, height: 260 } },
        ],
      }),
      { kind: "card", overlay: outroReel(OUTRO[0], OUTRO[1]), duration: 3.6, text: OUTRO.join(" ") },
      { kind: "card", overlay: endCardReel(svg), duration: 3.2, text: "InkBoard · tryinkboard.elabo.me" },
    ],
  },
];

export const PARTS: Record<VideoName, Part[]> = { walkthrough: WALKTHROUGH, reel: REEL };
export const FORMAT: Record<VideoName, Format> = { walkthrough: "wide", reel: "reel" };

export const partFile = (name: VideoName, i: number) => path.join(RENDERS, `${name}-part${i}.mp4`);
export const partMeta = (name: VideoName, i: number) => path.join(RENDERS, `${name}-part${i}.json`);

/** Render the given parts (all if none), each to its own MP4 plus its captions. */
export async function renderVideo(name: VideoName, only: number[]) {
  if (!PARTS[name]) throw new Error(`Unknown video ${name} (walkthrough | reel)`);
  mkdirSync(RENDERS, { recursive: true });
  await startProd(); // overlays are drawn on the app's own page, in its fonts
  try {
    const pal = await readPalette();
    const svg = await logoSvg();
    const format = FORMAT[name];
    const parts = PARTS[name];
    for (const [i, part] of parts.entries()) {
      if (only.length && !only.includes(i)) continue;
      const prepared = prepare(part.build(svg), format);
      const { placed, duration } = place(prepared);
      console.log(`▸ ${name} part ${i} (${part.name}): ${duration.toFixed(1)}s`);
      const t0 = Date.now();
      // The reel opens straight on its hook: no fade-in on its first frame.
      await renderPart(placed, duration, format, pal, partFile(name, i), {
        fadeIn: name === "reel" && i === 0 ? 0 : 0.45,
        // The last part ends on the end card itself (no fade to blank paper).
        fadeOut: i === parts.length - 1 ? 0 : 0.45,
      });
      writeFileSync(
        partMeta(name, i),
        JSON.stringify({ name: part.name, duration, captions: captionTimeline(placed) }, null, 2),
      );
      console.log(`  rendered in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  } finally {
    await closeOverlayPages();
    await closeBrowser();
    await stopProd();
  }
}
