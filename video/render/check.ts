/**
 * Checks of the finished videos: ffprobe (resolution, duration, codecs,
 * audio track) and contact sheets, a frame every few seconds with its
 * timestamp, to look through for unreadable text, overlays, empty screens
 * and anything in the reel's unsafe zones (drawn on the reel sheets).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { OUT } from "../lib/config";
import { REEL_SAFE } from "./compose";
import { finalFile } from "./finish";
import type { VideoName } from "./videos";

export const SHEETS = path.join(OUT, "sheets");

function probe(file: string) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration,size:stream=codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,sample_rate,channels", "-of", "json", file],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`ffprobe ${file}: ${r.stderr}`);
  return JSON.parse(r.stdout) as {
    format: { duration: string; size: string };
    streams: { codec_type: string; codec_name: string; profile?: string; width?: number; height?: number; pix_fmt?: string; r_frame_rate?: string; sample_rate?: string; channels?: number }[];
  };
}

/** faststart: the moov atom comes before mdat. */
function faststart(file: string) {
  const buf = readFileSync(file).subarray(0, 1 << 20);
  const moov = buf.indexOf("moov");
  const mdat = buf.indexOf("mdat");
  return moov !== -1 && (mdat === -1 || moov < mdat);
}

async function sheets(v: VideoName, every: number) {
  const file = finalFile(v, ".mp4");
  const tmp = path.join(SHEETS, `_${v}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const wide = v === "walkthrough";
  const tw = wide ? 640 : 300;
  spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `fps=1/${every},scale=${tw}:-2`, path.join(tmp, "%04d.png")], { stdio: "inherit" });
  const frames = readdirSync(tmp).filter((f) => f.endsWith(".png")).sort();
  const cols = wide ? 4 : 6;
  const rows = wide ? 5 : 3;
  const per = cols * rows;
  const out: string[] = [];
  for (let s = 0; s * per < frames.length; s++) {
    const first = await loadImage(readFileSync(path.join(tmp, frames[0])));
    const th = first.height;
    const c = createCanvas(cols * (tw + 6) + 6, rows * (th + 30) + 6);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < per && s * per + i < frames.length; i++) {
      const n = s * per + i;
      const img = await loadImage(readFileSync(path.join(tmp, frames[n])));
      const x = 6 + (i % cols) * (tw + 6);
      const y = 6 + Math.floor(i / cols) * (th + 30);
      ctx.drawImage(img, x, y + 24);
      if (!wide) {
        // The reel's safe area, to check nothing that matters falls outside it.
        const k = tw / 1080;
        ctx.strokeStyle = "rgba(0,200,255,.8)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 60 * k, y + 24 + 220 * k, (940 - 60) * k, (1480 - 220) * k);
        ctx.strokeStyle = "rgba(255,80,80,.6)";
        ctx.strokeRect(x + REEL_SAFE.x * k, y + 24 + REEL_SAFE.y * k, REEL_SAFE.width * k, REEL_SAFE.height * k);
      }
      const t = n * every;
      ctx.fillStyle = "#fff";
      ctx.font = "bold 17px sans-serif";
      ctx.fillText(`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`, x + 2, y + 17);
    }
    const name = path.join(SHEETS, `${v}-${String(s + 1).padStart(2, "0")}.jpg`);
    writeFileSync(name, c.encodeSync("jpeg", 85));
    out.push(name);
  }
  rmSync(tmp, { recursive: true, force: true });
  return out;
}

export async function check() {
  mkdirSync(SHEETS, { recursive: true });
  for (const v of ["walkthrough", "reel"] as VideoName[]) {
    const file = finalFile(v, ".mp4");
    const p = probe(file);
    const video = p.streams.find((s) => s.codec_type === "video")!;
    const audio = p.streams.find((s) => s.codec_type === "audio");
    console.log(
      `▸ ${path.basename(file)}: ${video.width}×${video.height}, ${Number(p.format.duration).toFixed(1)}s, ` +
        `${video.codec_name} ${video.profile} ${video.pix_fmt} ${video.r_frame_rate} fps, ` +
        `audio: ${audio ? `${audio.codec_name} ${audio.sample_rate} Hz ×${audio.channels}` : "NONE"}, ` +
        `${(Number(p.format.size) / 1e6).toFixed(1)} MB, faststart: ${faststart(file) ? "yes" : "NO"}`,
    );
    const list = await sheets(v, v === "walkthrough" ? 4 : 3);
    console.log(`  contact sheets: ${list.map((f) => path.relative(process.cwd(), f)).join(", ")}`);
  }
}
