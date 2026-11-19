// What's new walkthrough: build steps that sit between the script, the voice and the video.
//   node scripts/wn-build.mjs script   src/whatsnew/script-source.json → src/whatsnew/data/script.json (voice.py's format)
//   node scripts/wn-build.mjs place    voice timings → src/whatsnew/data/placement.json (when each line starts, and the length)
//   node scripts/wn-build.mjs srt      → out/whats-new-walkthrough.srt (same pages as the video's captions)
import { readFileSync, writeFileSync } from "node:fs";
import { pageBreaks } from "../src/whatsnew/pages.ts";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => JSON.parse(readFileSync(root + p, "utf8"));
const source = read("src/whatsnew/script-source.json");

/** How Kokoro should say a shown word (the captions stay as written). */
const SAY = [
  [/^InkBoard([.,:;!?]*)$/, "Ink Board$1"],
  [/^Ewe([.,:;!?]*)$/, "Ehvay$1"],
  [/^Twi([.,:;!?]*)$/, "Chwee$1"],
  [/^Ga([.,:;!?]*)$/, "Gah$1"],
  [/^600([.,:;!?]*)$/, "six hundred$1"],
  [/^tryinkboard\.elabo\.me([.,:;!?]*)$/, "try ink board dot elabo dot me.$1"],
];
const say = (w) => SAY.reduce((s, [re, rep]) => (re.test(s) ? s.replace(re, rep) : s), w);

/** Timing rules: gaps between lines, and the chapter cards' own time. */
export const GAP = 0.42;
export const CARD_IN = 0.7; // sweep down + the card settling, before the chapter line
export const CARD_OUT = 1.05; // the card held after its line, then the sweep back
const START = 0.35;

const cmd = process.argv[2];
if (cmd === "script") {
  const lines = source.lines.map((l) => ({ id: l.id, words: l.text.split(/\s+/).map((w) => [w, say(w)]) }));
  writeFileSync(root + "src/whatsnew/data/script.json", JSON.stringify({ voice: source.voice, speed: source.speed, lines }, null, 1));
  console.log(`${lines.length} lines, ${lines.reduce((n, l) => n + l.words.length, 0)} words`);
} else if (cmd === "place") {
  const timing = read("src/whatsnew/data/voice-timing.json");
  const dur = Object.fromEntries(timing.lines.map((l) => [l.id, l.duration]));
  const at = {};
  const chapters = [];
  let t = START;
  for (const l of source.lines) {
    if (l.chapter) {
      const cardAt = t;
      t += CARD_IN;
      at[l.id] = +t.toFixed(3);
      t += dur[l.id] + CARD_OUT;
      chapters.push({ id: l.id, title: l.chapter, at: +cardAt.toFixed(3), end: +t.toFixed(3) });
      t += 0.35;
    } else {
      at[l.id] = +t.toFixed(3);
      t += Math.max(dur[l.id] + GAP, l.hold ?? 0);
    }
  }
  const total = +(t + 0.4).toFixed(2);
  writeFileSync(root + "src/whatsnew/data/placement.json", JSON.stringify({ duration: total, lines: at, chapters }, null, 1));
  console.log(`duration ${total}s (${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")})`);
  for (const c of chapters) console.log(`  ${c.at.toFixed(1).padStart(6)}s  Chapter · ${c.title}`);
} else if (cmd === "srt") {
  const timing = read("src/whatsnew/data/voice-timing.json");
  const place = read("src/whatsnew/data/placement.json");
  const ts = (s) => {
    const ms = Math.round(s * 1000);
    const p = (n, w = 2) => String(n).padStart(w, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  const cues = [];
  for (const l of timing.lines) {
    const src = source.lines.find((s) => s.id === l.id);
    const at = place.lines[l.id];
    if (src.chapter) {
      const n = source.lines.filter((s) => s.chapter).indexOf(src) + 1;
      cues.push([at, at + l.duration + 0.3, `Chapter ${n} · ${src.chapter}`]);
      continue;
    }
    const pages = pageBreaks(l.words.map((w) => w.text));
    pages.forEach((pg, i) => {
      const start = at + l.words[pg[0]].start;
      const next = pages[i + 1];
      const end = next ? at + l.words[next[0]].start - 0.02 : at + l.duration + 0.3;
      cues.push([start, end, pg.map((k) => l.words[k].text).join(" ")]);
    });
  }
  const srt = cues.map(([a, b, text], i) => `${i + 1}\n${ts(a)} --> ${ts(b)}\n${text}\n`).join("\n");
  writeFileSync(root + "out/whats-new-walkthrough.srt", srt);
  console.log(`${cues.length} cues → out/whats-new-walkthrough.srt`);
} else {
  console.error("usage: node scripts/wn-build.mjs script|place|srt");
  process.exit(1);
}
