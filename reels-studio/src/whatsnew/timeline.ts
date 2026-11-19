import { spring } from "remotion";
import placement from "./data/placement.json";
import timing from "./data/voice-timing.json";
import source from "./script-source.json";
import { CAMERA_SPRING } from "../theme";
import { FPS } from "./theme";

export const f = (sec: number) => Math.round(sec * FPS);
export const DURATION: number = placement.duration;

export type Word = { text: string; start: number; end: number };
export type Line = { id: string; at: number; duration: number; words: Word[]; chapter?: string };

const AT = placement.lines as Record<string, number>;
export const LINES: Line[] = timing.lines.map((l) => ({
  id: l.id,
  at: AT[l.id],
  duration: l.duration,
  words: l.words as Word[],
  chapter: (source.lines as { id: string; chapter?: string }[]).find((s) => s.id === l.id)?.chapter,
}));
const BY_ID = Object.fromEntries(LINES.map((l) => [l.id, l]));

/** When a line starts, and when its voice ends (seconds). */
export const T = (id: string) => BY_ID[id].at;
export const E = (id: string) => BY_ID[id].at + BY_ID[id].duration;
/** When a given word of a line is spoken. */
export const TW = (id: string, word: number) => BY_ID[id].at + BY_ID[id].words[word].start;

export type Chapter = { id: string; title: string; at: number; end: number; n: number };
export const CHAPTERS: Chapter[] = placement.chapters.map((c, i) => ({ ...c, n: i + 1 }));
export const SWEEP = 0.5;

/** Additive springs, as the Reel's timeline does, at this composition's frame rate. */
export type Key = { at: number; snap?: boolean; config?: { damping?: number; stiffness?: number; mass?: number } } & Record<string, unknown>;
export function track<T2 extends Record<string, number>>(frame: number, keys: (Key & Partial<T2>)[], fields: (keyof T2)[], start: T2): T2 {
  const out = { ...start };
  let prev = { ...start };
  for (const k of keys) {
    const next = { ...prev };
    for (const name of fields) if (typeof k[name as string] === "number") (next as Record<string, number>)[name as string] = k[name as string] as number;
    const p = k.snap ? (frame >= f(k.at) ? 1 : 0) : spring({ frame: frame - f(k.at), fps: FPS, config: { ...CAMERA_SPRING, ...k.config } });
    for (const name of fields) {
      const n = name as string;
      (out as Record<string, number>)[n] += ((next as Record<string, number>)[n] - (prev as Record<string, number>)[n]) * p;
    }
    prev = next;
  }
  return out;
}
