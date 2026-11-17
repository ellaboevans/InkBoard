import { describe, expect, it } from "vitest";
import { sniffImageType, typeError } from "@/lib/photo-sniff";
import { png, phoneJpeg, webp } from "../support/photos";

const bytes = (s: string) => new TextEncoder().encode(s);
const ftyp = (major: string, ...compatible: string[]) => {
  const brands = [major, "\0\0\0\0", ...compatible].join("");
  const size = 8 + brands.length;
  return new Uint8Array([0, 0, 0, size, ...bytes("ftyp"), ...bytes(brands), 0, 0, 0, 0]);
};

describe("the real type, from the bytes (Phase 22)", () => {
  it("knows JPEG, PNG and WebP", async () => {
    expect(sniffImageType(await phoneJpeg())).toBe("jpeg");
    expect(sniffImageType(await png())).toBe("png");
    expect(sniffImageType(await webp())).toBe("webp");
  });

  it("knows HEIC and AVIF (which we refuse, with their own message)", () => {
    expect(sniffImageType(ftyp("heic", "mif1", "heic"))).toBe("heic");
    expect(sniffImageType(ftyp("mif1", "heic"))).toBe("heic");
    expect(sniffImageType(ftyp("avif", "mif1"))).toBe("avif");
    expect(typeError("heic")).toMatch(/HEIC/);
    expect(typeError("heic")).toMatch(/iPhone sends JPEG/);
  });

  it("anything else is unknown: text, PDF, GIF, SVG, empty, a few stray bytes", () => {
    for (const s of ["hello, this is text", "%PDF-1.7", "GIF89a......", '<svg xmlns="http://www.w3.org/2000/svg"/>', "", "\xff\xd8"]) {
      expect(sniffImageType(bytes(s)), s).toBe("unknown");
    }
    expect(typeError("unknown")).toMatch(/JPEG, PNG or WebP/);
  });
});
