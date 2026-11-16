/**
 * Join each video's parts, add a silent stereo track (some platforms reject
 * video without audio), and write the deliverables to video/.out/final:
 * the MP4 (H.264, yuv420p, faststart), an .srt, a voiceover script with
 * timings, and a cover image.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { OUT, TAKES } from "../lib/config";
import { closeBrowser, type Take } from "../lib/recorder";
import { startProd, stopProd } from "../lib/servers";
import { background, FPS } from "./compose";
import { closeOverlayPages, coverText, logoSvg, readPalette, renderOverlay } from "./overlays";
import { PARTS, partFile, partMeta, type VideoName } from "./videos";

export const FINAL = path.join(OUT, "final");
const BASENAME: Record<VideoName, string> = { walkthrough: "inkboard-walkthrough", reel: "inkboard-reel" };
export const finalFile = (v: VideoName, ext: string) => path.join(FINAL, `${BASENAME[v]}${ext}`);

type Meta = { name: string; duration: number; captions: { start: number; end: number; text: string }[] };

function ffmpeg(args: string[]) {
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`);
}

const srtTime = (t: number) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** Wrap a caption into at most two lines of about 42 characters, as players expect. */
function srtLines(text: string) {
  if (text.length <= 42) return text;
  const words = text.split(" ");
  let best = text;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const diff = Math.abs(a.length - b.length);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = `${a}\n${b}`;
    }
  }
  return best;
}

async function join(v: VideoName) {
  const parts = PARTS[v];
  const list = path.join(FINAL, `${BASENAME[v]}.ffconcat`);
  const metas: Meta[] = [];
  const lines = ["ffconcat version 1.0"];
  for (let i = 0; i < parts.length; i++) {
    if (!existsSync(partFile(v, i))) throw new Error(`Missing ${partFile(v, i)}: run pnpm video render ${v}`);
    lines.push(`file '${partFile(v, i)}'`);
    metas.push(JSON.parse(readFileSync(partMeta(v, i), "utf8")) as Meta);
  }
  writeFileSync(list, lines.join("\n") + "\n");
  ffmpeg([
    "-f", "concat", "-safe", "0", "-i", list,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest",
    "-movflags", "+faststart", finalFile(v, ".mp4"),
  ]);
  rmSync(list);

  // Captions and the voiceover script, on the joined timeline.
  let offset = 0;
  const caps: { start: number; end: number; text: string; part: string }[] = [];
  for (const m of metas) {
    for (const c of m.captions) caps.push({ start: c.start + offset, end: c.end + offset, text: c.text, part: m.name });
    offset += Math.round(m.duration * FPS) / FPS;
  }
  writeFileSync(
    finalFile(v, ".srt"),
    caps.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end - 0.05)}\n${srtLines(c.text)}\n`).join("\n"),
  );
  const md = [
    `# ${v === "walkthrough" ? "InkBoard walkthrough" : "InkBoard reel"}: voiceover script`,
    "",
    `Total length ${clock(offset)}. Each line can be read in the time shown; the on-screen captions already say the same,`,
    "so a voiceover is optional. Record at a relaxed pace and drop it under the video as is, or add music under it.",
    "",
    "| Start | End | Line |",
    "| --- | --- | --- |",
    ...caps.map((c) => `| ${clock(c.start)} | ${clock(c.end)} | ${c.text.replace(/\|/g, "\\|")} |`),
    "",
  ].join("\n");
  writeFileSync(finalFile(v, "-voiceover.md"), md);
  return offset;
}

async function frameOf(takeId: string, at: number) {
  const t = JSON.parse(readFileSync(path.join(TAKES, takeId, "take.json"), "utf8")) as Take;
  const time = at >= 0 ? t.start + at : t.end + at;
  let f = t.frames[0];
  for (const x of t.frames) if (x.t <= time) f = x;
  return { take: t, img: await loadImage(readFileSync(path.join(TAKES, takeId, f.file))) };
}

/** Covers: the logo, a title, and the real app in its frame. */
async function covers() {
  const pal = await readPalette();
  const svg = await logoSvg();

  // Walkthrough, 1920×1080: text left, the board in a window on the right.
  {
    const c = createCanvas(1920, 1080);
    const ctx = c.getContext("2d");
    ctx.drawImage(background("wide", pal), 0, 0);
    const { img } = await frameOf("language", 3.2);
    const x = 900, y = 170, w = 1200, h = 675 + 46;
    ctx.save();
    ctx.shadowColor = "rgba(60,35,15,.3)";
    ctx.shadowBlur = 60;
    ctx.shadowOffsetY = 24;
    ctx.fillStyle = pal.paper;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 18);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 18);
    ctx.clip();
    ctx.fillStyle = "#efe8dc";
    ctx.fillRect(x, y, w, 46);
    ["#e9695e", "#e9b84f", "#6cbf5d"].forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x + 26 + i * 22, y + 23, 7, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.drawImage(img, 0, 0, img.width, img.height, x, y + 46, w, (w * img.height) / img.width);
    ctx.restore();
    const text = await loadImage(await renderOverlay(coverText(svg, "How InkBoard works", "Read, write and share poems in Ewe, Akan, Ga and English", 760, 1080, 104)));
    ctx.drawImage(text, 110, 0);
    writeFileSync(finalFile("walkthrough", "-cover.png"), c.encodeSync("png"));
    writeFileSync(finalFile("walkthrough", "-cover.jpg"), c.encodeSync("jpeg", 92));
  }

  // Reel, 1080×1920: text in the top safe area, the phone below.
  {
    const c = createCanvas(1080, 1920);
    const ctx = c.getContext("2d");
    ctx.drawImage(background("reel", pal), 0, 0);
    const { img } = await frameOf("phone-board", -1);
    const sw = 560, sh = (sw * img.height) / img.width;
    const px = 505 - sw / 2 - 14, py = 760;
    ctx.save();
    ctx.shadowColor = "rgba(60,35,15,.3)";
    ctx.shadowBlur = 50;
    ctx.shadowOffsetY = 20;
    ctx.fillStyle = "#1f1915";
    ctx.beginPath();
    ctx.roundRect(px, py, sw + 28, sh + 28, 64);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(px + 14, py + 14, sw, sh, 52);
    ctx.clip();
    ctx.drawImage(img, px + 14, py + 14, sw, sh);
    ctx.restore();
    const text = await loadImage(await renderOverlay(coverText(svg, "Poems you can wander", "In Ewe, Akan, Ga and English", 820, 520, 96)));
    ctx.drawImage(text, 90, 220);
    writeFileSync(finalFile("reel", "-cover.png"), c.encodeSync("png"));
    writeFileSync(finalFile("reel", "-cover.jpg"), c.encodeSync("jpeg", 92));
  }
}

export async function finish() {
  mkdirSync(FINAL, { recursive: true });
  for (const v of ["walkthrough", "reel"] as VideoName[]) {
    const d = await join(v);
    console.log(`▸ ${finalFile(v, ".mp4")} (${clock(d)})`);
  }
  await startProd();
  try {
    await covers();
  } finally {
    await closeOverlayPages();
    await closeBrowser();
    await stopProd();
  }
  console.log(`▸ covers, captions and voiceover scripts in ${FINAL}`);
}
