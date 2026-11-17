import { PHOTO_MAX_BYTES, PHOTO_SHRINK_SIDE } from "./photo-limits";

/**
 * Browser only: a smaller JPEG copy of a photo that is over the upload limit
 * (phones' cameras easily make 6–12 MB files). The orientation is applied
 * while drawing (createImageBitmap's default "from-image"), so the crop's
 * fractions, measured on the photo as seen, still mean the same thing. The
 * server checks and processes this copy like any upload.
 */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, PHOTO_SHRINK_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bitmap, 0, 0, w, h);
    for (const quality of [0.9, 0.8, 0.7]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= PHOTO_MAX_BYTES) return blob;
    }
    throw new Error("still too large");
  } finally {
    bitmap.close();
  }
}
