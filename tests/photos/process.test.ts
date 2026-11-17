import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { PHOTO_JPEG_SIZE, PHOTO_MAX_BYTES, PHOTO_WEBP_SIZES } from "@/lib/photo-limits";
import { processPhoto, readPhotoHeader } from "@/server/photos/process";
import { bombPng, halves, isBlueish, isRedish, phoneJpeg, pixel, png, webp } from "../support/photos";

const WHOLE = { x: 0, y: 0, size: 1 };

/** Every metadata marker a JPEG or WebP could carry it in. */
function metadataMarkers(file: Uint8Array): string[] {
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

describe("processing a photo (Phase 22)", () => {
  it("strips all metadata: a phone photo with GPS, camera, date, XMP and an ICC profile comes out with none", async () => {
    const input = await phoneJpeg({ orientation: 1 });
    // The input really has it all.
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();
    expect(before.xmp).toBeDefined();
    expect(before.icc).toBeDefined();
    expect(metadataMarkers(input)).toEqual(expect.arrayContaining(["Exif", "PhoneMaker", "XMP-SECRET-CREATOR", "ICC_PROFILE"]));

    const out = await processPhoto(input, WHOLE);
    if (!out.ok) throw new Error(out.error);
    for (const file of [...PHOTO_WEBP_SIZES.map((s) => out.webp[s]), out.jpeg]) {
      const meta = await sharp(file).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(meta.iptc).toBeUndefined();
      expect(meta.hasProfile).toBe(false);
      expect(meta.orientation).toBeUndefined();
      expect(metadataMarkers(file)).toEqual([]);
    }
  });

  it("writes square WebP copies at every size, and a JPEG for Satori", async () => {
    const out = await processPhoto(await phoneJpeg({ width: 1200, height: 800 }), WHOLE);
    if (!out.ok) throw new Error(out.error);
    for (const s of PHOTO_WEBP_SIZES) {
      const m = await sharp(out.webp[s]).metadata();
      expect([m.format, m.width, m.height, m.space]).toEqual(["webp", s, s, "srgb"]);
    }
    const j = await sharp(out.jpeg).metadata();
    expect([j.format, j.width, j.height, j.space]).toEqual(["jpeg", PHOTO_JPEG_SIZE, PHOTO_JPEG_SIZE, "srgb"]);
    expect(out.source).toEqual({ type: "jpeg", width: 1200, height: 800 });
  });

  it("honours EXIF orientation before cropping: the crop is of the photo as seen", async () => {
    // Stored 400×300, left red / right blue; orientation 6 shows it turned a
    // quarter clockwise, 300×400 with red on top.
    const input = await phoneJpeg({ width: 400, height: 300, orientation: 6 });
    expect((await readPhotoHeader(input)).ok && (await readPhotoHeader(input))).toMatchObject({ orientedWidth: 300, orientedHeight: 400 });
    const top = await processPhoto(input, { x: 0, y: 0, size: 0.5 });
    const bottom = await processPhoto(input, { x: 0, y: 0.6, size: 0.5 });
    if (!top.ok || !bottom.ok) throw new Error("failed");
    expect(isRedish(await pixel(top.jpeg, 256, 256))).toBe(true);
    expect(isBlueish(await pixel(bottom.jpeg, 256, 256))).toBe(true);
    // Unrotated, the same crop of the top-left would be red, and of the right half blue.
    const flat = await processPhoto(await phoneJpeg({ width: 400, height: 300 }), { x: 0.6, y: 0, size: 0.5 });
    if (!flat.ok) throw new Error("failed");
    expect(isBlueish(await pixel(flat.jpeg, 256, 256))).toBe(true);
  });

  it("applies the crop: a portrait photo cropped to its top square, a landscape one to its left", async () => {
    const landscape = await processPhoto(await png(800, 400), { x: 0, y: 0, size: 1 });
    if (!landscape.ok) throw new Error("failed");
    expect(isRedish(await pixel(landscape.jpeg, 100, 256))).toBe(true);
    expect(isRedish(await pixel(landscape.jpeg, 500, 256))).toBe(true); // the left square is all red
    const portrait = await processPhoto(await webp(300, 900), { x: 0, y: 0, size: 1 });
    if (!portrait.ok) throw new Error("failed");
    expect(isRedish(await pixel(portrait.jpeg, 10, 256))).toBe(true);
    expect(isBlueish(await pixel(portrait.jpeg, 500, 256))).toBe(true);
  });

  it("refuses a crop outside the photo or too small", async () => {
    const input = await png(400, 300);
    expect(await processPhoto(input, { x: 0.5, y: 0, size: 1 })).toEqual({ ok: false, error: "crop" });
    expect(await processPhoto(input, { x: 0, y: 0, size: 0.1 })).toEqual({ ok: false, error: "crop" }); // 30 px
  });

  it("checks the type from the bytes: a PNG named .jpg is a PNG; text, truncated and HEIC files are refused", async () => {
    const pngBytes = await png(200, 200);
    expect(await readPhotoHeader(pngBytes)).toMatchObject({ ok: true, type: "png" });
    expect(await processPhoto(new TextEncoder().encode("just some text, named photo.jpg"), WHOLE)).toEqual({ ok: false, error: "type", type: "unknown" });
    const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic\0\0\0\0mif1heic"), 0, 0, 0, 0]);
    expect(await processPhoto(heic, WHOLE)).toEqual({ ok: false, error: "type", type: "heic" });
    // A real JPEG cut in half: its header reads, but it can't be decoded.
    const jpeg = await (await halves(600, 600)).jpeg().toBuffer();
    expect(await processPhoto(jpeg.subarray(0, Math.floor(jpeg.length / 2)), WHOLE)).toEqual({ ok: false, error: "unreadable" });
    // Only the magic bytes, nothing after.
    expect(await processPhoto(jpeg.subarray(0, 20), WHOLE)).toEqual({ ok: false, error: "unreadable" });
    expect(await processPhoto(new Uint8Array(0), WHOLE)).toEqual({ ok: false, error: "empty" });
  });

  it("refuses files over the size limit before looking at them", async () => {
    const big = new Uint8Array(PHOTO_MAX_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(await processPhoto(big, WHOLE)).toEqual({ ok: false, error: "too_large" });
  });

  it("refuses a decompression bomb from its header, without decoding it", async () => {
    // 4 KB on disk; 30,000 × 30,000 × 3 bytes = 2.7 GB if decoded.
    const bomb = bombPng(30_000, 30_000, 4);
    expect(bomb.length).toBeLessThan(64 * 1024);
    const started = performance.now();
    expect(await processPhoto(bomb, WHOLE)).toEqual({ ok: false, error: "dimensions" });
    expect(performance.now() - started).toBeLessThan(1000);
    // Too long on one side, though few pixels in all.
    expect(await readPhotoHeader(bombPng(13_000, 10, 1))).toEqual({ ok: false, error: "dimensions" });
    // Under both limits (7,000 × 7,000 = 49 MP) the header is fine.
    expect(await readPhotoHeader(bombPng(7_000, 7_000, 1))).toMatchObject({ ok: true, width: 7000, height: 7000 });
  });
});
