/*
 * Advance widths straight from a TrueType file (cmap + hmtx), so the share
 * image can lay out its text exactly as Satori will draw it. Satori 0.29
 * applies no kerning or ligatures (its README), so a line's width is the sum
 * of its glyphs' advances, each glyph taken from the first font in the
 * family list that has it. Pure and dependency-free: tests read the same
 * font files the route does.
 */

export type FontMetrics = {
  unitsPerEm: number;
  /** Advance width in font units, or null when the font has no glyph for this code point. */
  advance(codePoint: number): number | null;
  /** The advance of the missing-glyph box (.notdef), in font units. */
  notdefAdvance: number;
};

type Tables = Record<string, { offset: number; length: number }>;

function tableDirectory(view: DataView): Tables {
  const count = view.getUint16(4);
  const tables: Tables = {};
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
    tables[tag] = { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) };
  }
  return tables;
}

/** code point → glyph id, from the best Unicode subtable (format 12, else format 4). */
function readCmap(view: DataView, base: number): (cp: number) => number {
  const count = view.getUint16(base + 2);
  let format4: number | null = null;
  let format12: number | null = null;
  for (let i = 0; i < count; i++) {
    const at = base + 4 + i * 8;
    const platform = view.getUint16(at);
    const encoding = view.getUint16(at + 2);
    const offset = base + view.getUint32(at + 4);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const format = view.getUint16(offset);
    if (format === 12) format12 ??= offset;
    if (format === 4) format4 ??= offset;
  }
  if (format12 !== null) {
    const at = format12;
    const groups = view.getUint32(at + 12);
    const starts: number[] = [];
    const ends: number[] = [];
    const glyphs: number[] = [];
    for (let i = 0; i < groups; i++) {
      starts.push(view.getUint32(at + 16 + i * 12));
      ends.push(view.getUint32(at + 20 + i * 12));
      glyphs.push(view.getUint32(at + 24 + i * 12));
    }
    return (cp) => {
      for (let i = 0; i < groups; i++) if (cp >= starts[i] && cp <= ends[i]) return glyphs[i] + (cp - starts[i]);
      return 0;
    };
  }
  if (format4 === null) return () => 0;
  const at = format4;
  const segX2 = view.getUint16(at + 6);
  const ends = at + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let s = 0; s < segX2; s += 2) {
      if (cp > view.getUint16(ends + s)) continue;
      const start = view.getUint16(starts + s);
      if (cp < start) return 0;
      const delta = view.getInt16(deltas + s);
      const rangeOffset = view.getUint16(rangeOffsets + s);
      if (rangeOffset === 0) return (cp + delta) & 0xffff;
      const glyph = view.getUint16(rangeOffsets + s + rangeOffset + (cp - start) * 2);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
}

/** Reads a .ttf/.otf (TrueType or CFF outlines; only cmap, head, hhea and hmtx are used). */
export function readFontMetrics(data: ArrayBuffer | Uint8Array): FontMetrics {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = tableDirectory(view);
  for (const tag of ["cmap", "head", "hhea", "hmtx"]) {
    if (!tables[tag]) throw new Error(`font has no ${tag} table`);
  }
  const unitsPerEm = view.getUint16(tables.head.offset + 18);
  const longMetrics = view.getUint16(tables.hhea.offset + 34);
  const hmtx = tables.hmtx.offset;
  const glyphAdvance = (glyph: number) => view.getUint16(hmtx + Math.min(glyph, longMetrics - 1) * 4);
  const glyphFor = readCmap(view, tables.cmap.offset);
  const cache = new Map<number, number | null>();
  return {
    unitsPerEm,
    notdefAdvance: glyphAdvance(0),
    advance(cp) {
      let value = cache.get(cp);
      if (value === undefined) {
        const glyph = glyphFor(cp);
        value = glyph === 0 ? null : glyphAdvance(glyph);
        cache.set(cp, value);
      }
      return value;
    },
  };
}

/**
 * Width in px of `text` at `fontSize`, taking each character from the first
 * font in `chain` that has it (as Satori does), else the first font's box.
 */
export function measureWith(chain: FontMetrics[], text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    let found = false;
    for (const font of chain) {
      const adv = font.advance(cp);
      if (adv !== null) {
        width += (adv / font.unitsPerEm) * fontSize;
        found = true;
        break;
      }
    }
    if (!found) width += (chain[0].notdefAdvance / chain[0].unitsPerEm) * fontSize;
  }
  return width;
}
