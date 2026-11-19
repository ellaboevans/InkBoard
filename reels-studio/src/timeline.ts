import { spring } from "remotion";
import placement from "./data/placement.json";
import timing from "./data/voice-timing.json";
import { CAMERA_SPRING, FPS } from "./theme";

export const f = (sec: number) => Math.round(sec * FPS);

export type Word = { text: string; start: number; end: number; page?: boolean };
export type Line = { id: string; at: number; duration: number; words: Word[] };

export const LINES: Line[] = timing.lines.map((l) => ({
  id: l.id,
  at: (placement as Record<string, number | string>)[l.id] as number,
  duration: l.duration,
  words: l.words as Word[],
}));

/**
 * Additive springs: each key after the first adds its difference to the
 * previous key, eased by its own spring starting at its time. A key with
 * `snap` jumps instead (a cut).
 */
export type Key = { at: number; snap?: boolean; config?: { damping?: number; stiffness?: number; mass?: number } } & Record<string, unknown>;

export function track<T extends Record<string, number>>(frame: number, keys: (Key & Partial<T>)[], fields: (keyof T)[], start: T): T {
  const out = { ...start };
  let prev = { ...start };
  for (const k of keys) {
    const next = { ...prev };
    for (const name of fields) if (typeof k[name as string] === "number") (next as Record<string, number>)[name as string] = k[name as string] as number;
    const p = k.snap
      ? frame >= f(k.at) ? 1 : 0
      : spring({ frame: frame - f(k.at), fps: FPS, config: { ...CAMERA_SPRING, ...k.config } });
    for (const name of fields) {
      const n = name as string;
      (out as Record<string, number>)[n] += ((next as Record<string, number>)[n] - (prev as Record<string, number>)[n]) * p;
    }
    prev = next;
  }
  return out;
}
