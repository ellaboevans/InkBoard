import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";

/*
 * Test photos, generated in the test (no binaries in the repo; Phase 22).
 */

export type Colour = { r: number; g: number; b: number };
export const RED = { r: 220, g: 20, b: 20 };
export const BLUE = { r: 20, g: 40, b: 220 };

/**
 * A width × height picture whose left half is red and right half blue
 * (as stored, before any EXIF orientation), so orientation and crops can be
 * told apart by sampling pixels.
 */
export async function halves(width: number, height: number) {
  const left = await sharp({ create: { width: Math.floor(width / 2), height, channels: 3, background: RED } }).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background: BLUE } }).composite([{ input: left, left: 0, top: 0 }]);
}

/** A JPEG carrying everything a phone writes: EXIF with GPS and camera, XMP, an ICC profile, an orientation. */
export async function phoneJpeg({ width = 400, height = 300, orientation = 1 }: { width?: number; height?: number; orientation?: number } = {}) {
  return (await halves(width, height))
    .withMetadata({ orientation })
    .withExif({
      IFD0: { Make: "PhoneMaker", Model: "Phone 15 Pro", Software: "PhoneOS 18.1", Artist: "Ada Verse" },
      IFD2: { DateTimeOriginal: "2026:05:01 10:00:00" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "5/1 33/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 12/1 0/1" },
    })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>XMP-SECRET-CREATOR</dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>')
    .withIccProfile("p3")
    .jpeg({ quality: 90 })
    .toBuffer();
}

export const png = async (width = 300, height = 300) => (await halves(width, height)).png().toBuffer();
export const webp = async (width = 300, height = 300) => (await halves(width, height)).webp().toBuffer();

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * A decompression bomb: a valid PNG of a few kilobytes that declares
 * width × height pixels (all zeros compress to almost nothing). Decoding it
 * would need width × height × 3 bytes of memory.
 */
export function bombPng(width: number, height: number, rows = 64): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  // Only the first rows' data: enough to look real, small to build.
  const raw = Buffer.alloc((width * 3 + 1) * rows);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The colour at (x, y) of an encoded picture. */
export async function pixel(bytes: Uint8Array, x: number, y: number): Promise<Colour> {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

export const isRedish = (c: Colour) => c.r > 150 && c.b < 100;
export const isBlueish = (c: Colour) => c.b > 150 && c.r < 100;

/** A Blob as the Server Action receives it from FormData. */
export const fileOf = (bytes: Uint8Array, name = "photo.jpg", type = "image/jpeg") => new File([bytes as BlobPart], name, { type });

/** Every metadata marker a JPEG or WebP could carry it in. */
export function metadataMarkers(file: Uint8Array): string[] {
  const buf = Buffer.from(file);
  const found: string[] = [];
  for (const s of ["Exif", "EXIF", "GPS", "PhoneMaker", "Phone 15 Pro", "Ada Verse", "2026:05:01", "XMP-SECRET-CREATOR", "http://ns.adobe.com/xap", "x:xmpmeta", "ICC_PROFILE", "ICCP", "XMP ", "Display P3", "iptc", "Photoshop"]) {
    if (buf.includes(s)) found.push(s);
  }
  // JPEG APPn segments other than JFIF's APP0 (APP1 = EXIF/XMP, APP2 = ICC, APP13 = IPTC).
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 4 <= buf.length && buf[i] === 0xff) {
      const marker = buf[i + 1];
      if (marker === 0xda) break; // start of scan: no more headers
      if (marker >= 0xe1 && marker <= 0xef) found.push(`APP${marker - 0xe0}`);
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return found;
}

