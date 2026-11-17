/**
 * What an uploaded file really is, from its first bytes: never the name or
 * the browser's MIME type (docs/PLAN.md, Phase 22). Pure and client-safe.
 */

export type SniffedType = "jpeg" | "png" | "webp" | "heic" | "avif" | "unknown";
export type AcceptedType = "jpeg" | "png" | "webp";

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

export function sniffImageType(bytes: Uint8Array): SniffedType {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v)
  ) {
    return "png";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  // ISO BMFF: size, "ftyp", major brand, minor version, compatible brands…
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const boxEnd = Math.min(bytes.length, new DataView(bytes.buffer, bytes.byteOffset).getUint32(0) || 12);
    const brands = [ascii(bytes, 8, 12)];
    for (let i = 16; i + 4 <= boxEnd; i += 4) brands.push(ascii(bytes, i, i + 4));
    if (brands.some((b) => AVIF_BRANDS.has(b))) return "avif";
    if (brands.some((b) => HEIC_BRANDS.has(b))) return "heic";
  }
  return "unknown";
}

export function isAcceptedType(t: SniffedType): t is AcceptedType {
  return t === "jpeg" || t === "png" || t === "webp";
}

/** The one message for each refused type, shown in the toast and inline. */
export function typeError(t: SniffedType): string {
  if (t === "heic") {
    return "HEIC photos can't be used yet. Choose a JPEG, PNG or WebP photo (an iPhone sends JPEG when you pick from Photos).";
  }
  return "That file isn't a photo we can use. Choose a JPEG, PNG or WebP photo.";
}
