"use client";

import { cn } from "cn";
import { ImageUpIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition, type PointerEvent as ReactPointerEvent } from "react";
import { AuthorPicture } from "@/components/author/author-picture";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AuthorPicture as Picture } from "@/lib/author-picture";
import { notify, UNEXPECTED_ERROR } from "@/lib/notify";
import {
  clampView,
  CROP_ZOOM_MAX,
  CROP_ZOOM_MIN,
  cropFromView,
  encodeCrop,
  initialView,
  panRange,
  panView,
  type CropView,
} from "@/lib/photo-crop";
import { formatMegabytes, PHOTO_ACCEPT, PHOTO_MAX_BYTES, PHOTO_SOURCE_MAX_BYTES } from "@/lib/photo-limits";
import { photoProblemMessage } from "@/lib/photo-messages";
import { shrinkPhoto } from "@/lib/photo-resize";
import { isAcceptedType, sniffImageType } from "@/lib/photo-sniff";
import { removePhotoAction, savePhotoAction } from "./photo-actions";

/*
 * Profile photo: choose (camera or library), crop to a square, preview it
 * round at the sizes it shows, save (docs/PLAN.md, Phase 22). The crop is
 * sent as fractions with the original file (or a smaller copy the browser
 * made when the file is over the upload limit); the server applies it, so
 * what's stored is always our own processed copy.
 *
 * The crop works by dragging the photo, and equally with the three named
 * sliders (zoom, left–right, up–down), which are the keyboard and screen
 * reader path.
 */

const TOUCH = "h-11 px-4 text-[15px] sm:h-9 sm:px-3 sm:text-sm pointer-coarse:h-11";

type Chosen = { file: File; url: string; width: number; height: number };

export function ProfilePhotoPanel({ picture }: { picture: Picture }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [checking, setChecking] = useState(false);
  const hasPhoto = picture.photoKey !== null;
  const helpId = useId();
  // True once hydrated: the file input's handler exists (E2E waits for data-ready).
  const ready = useSyncExternalStore(noSubscribe, () => true, () => false);
  // After "Remove photo", the button that opened the dialog is gone: focus "Upload photo".
  const hadPhoto = useRef(hasPhoto);
  useEffect(() => {
    const removed = hadPhoto.current && !hasPhoto;
    hadPhoto.current = hasPhoto;
    if (!removed) return;
    // After Radix's own focus restore on the dialog's unmount (to the now-gone button).
    const t = setTimeout(() => chooseRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [hasPhoto]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > PHOTO_SOURCE_MAX_BYTES) {
      notify.error("Couldn't use that photo", photoProblemMessage("source_too_large"));
      return;
    }
    setChecking(true);
    try {
      const type = sniffImageType(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
      if (!isAcceptedType(type)) {
        notify.error("Couldn't use that photo", photoProblemMessage("type", type));
        return;
      }
      const url = URL.createObjectURL(file);
      const size = await naturalSize(url).catch(() => null);
      if (!size) {
        URL.revokeObjectURL(url);
        notify.error("Couldn't use that photo", photoProblemMessage("unreadable"));
        return;
      }
      setChosen({ file, url, ...size });
    } finally {
      setChecking(false);
    }
  }

  function close() {
    if (chosen) URL.revokeObjectURL(chosen.url);
    setChosen(null);
  }

  return (
    <section aria-labelledby="photo-heading" id="photo" data-ready={ready ? "true" : undefined} className="grid scroll-mt-20 gap-4 rounded-xl border bg-card p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <AuthorPicture picture={picture} size={72} className="size-18" />
        <div className="grid min-w-0 gap-1">
          <h2 id="photo-heading" className="font-medium">
            Profile photo
          </h2>
          <p id={helpId} className="text-sm text-muted-foreground">
            {hasPhoto
              ? "Shown round next to your pen name everywhere, instead of your avatar."
              : "Use a photo of yourself instead of your avatar. JPEG, PNG or WebP"}
            {!hasPhoto && <>, up to {formatMegabytes(PHOTO_SOURCE_MAX_BYTES)} (bigger than {formatMegabytes(PHOTO_MAX_BYTES)} is made smaller on your device first).</>}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={PHOTO_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-photo-input
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Let the same file be chosen again after a cancel.
            e.target.value = "";
            void onFile(file);
          }}
        />
        <Button ref={chooseRef} type="button" variant="outline" className={TOUCH} aria-describedby={helpId} disabled={checking} onClick={() => inputRef.current?.click()}>
          {checking ? <Loader2Icon className="animate-spin" aria-hidden /> : <ImageUpIcon aria-hidden />}
          {hasPhoto ? "Change photo" : "Upload photo"}
        </Button>
        {hasPhoto && <RemovePhotoButton onDone={() => chooseRef.current?.focus()} />}
      </div>
      {chosen && <CropDialog chosen={chosen} onClose={close} returnFocus={() => chooseRef.current?.focus()} />}
    </section>
  );
}

const noSubscribe = () => () => {};

function naturalSize(url: string): Promise<{ width: number; height: number }> {
  // An <img> applies EXIF orientation (image-orientation: from-image), so these
  // are the photo as seen: the same space the server crops in.
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => (img.naturalWidth && img.naturalHeight ? resolve({ width: img.naturalWidth, height: img.naturalHeight }) : reject(new Error("empty")));
    img.onerror = () => reject(new Error("decode"));
    img.src = url;
  });
}

/** Where the photo sits so the crop square fills a box: percentages, so any box size works. */
function placement(view: CropView, width: number, height: number) {
  const crop = cropFromView(view, width, height);
  const short = Math.min(width, height);
  const scale = view.zoom / short; // box widths per source pixel
  return {
    width: `${width * scale * 100}%`,
    height: `${height * scale * 100}%`,
    left: `${-crop.x * width * scale * 100}%`,
    top: `${-crop.y * height * scale * 100}%`,
  };
}

function CroppedPhoto({ chosen, view, className }: { chosen: Chosen; view: CropView; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden", className)} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL being cropped */}
      <img src={chosen.url} alt="" draggable={false} className="absolute max-w-none select-none" style={placement(view, chosen.width, chosen.height)} />
    </div>
  );
}

const PREVIEW_SIZES = [
  { px: 112, label: "Author page" },
  { px: 40, label: "Board" },
  { px: 32, label: "Byline" },
] as const;

function CropDialog({ chosen, onClose, returnFocus }: { chosen: Chosen; onClose: () => void; returnFocus: () => void }) {
  const { width, height } = chosen;
  const [view, setView] = useState<CropView>(() => clampView(initialView(), width, height));
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const range = panRange(view, width, height);
  const canPanX = range.x[1] - range.x[0] > 1e-6;
  const canPanY = range.y[1] - range.y[0] > 1e-6;
  const zoomId = useId();
  const xId = useId();
  const yId = useId();
  const errorId = useId();

  const update = (next: Partial<CropView>) => setView((v) => clampView({ ...v, ...next }, width, height));

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !boxRef.current) return;
    const box = boxRef.current.getBoundingClientRect().width;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    drag.current = { ...d, x: e.clientX, y: e.clientY };
    setView((v) => panView(v, dx, dy, box, width, height));
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.id === e.pointerId) drag.current = null;
  }

  function save() {
    setError(null);
    startSaving(async () => {
      try {
        let file: Blob = chosen.file;
        if (file.size > PHOTO_MAX_BYTES) {
          const smaller = await shrinkPhoto(chosen.file).catch(() => null);
          if (!smaller || smaller.size > PHOTO_MAX_BYTES) {
            const message = photoProblemMessage("too_large");
            setError(message);
            notify.error("Couldn't save your photo", message);
            return;
          }
          file = smaller;
        }
        const form = new FormData();
        form.set("photo", file, "photo");
        form.set("crop", encodeCrop(cropFromView(view, width, height)));
        const res = await savePhotoAction(form);
        if (res.ok) {
          notify.success("Photo saved", "It now shows next to your pen name.");
          onClose();
        } else {
          setError(res.error);
          notify.error("Couldn't save your photo", res.error);
        }
      } catch {
        // Network failure or a server error: nothing was saved; the old photo stays.
        setError(UNEXPECTED_ERROR.description);
        notify.error(UNEXPECTED_ERROR.title, UNEXPECTED_ERROR.description);
      }
    });
  }

  const pct = (v: number, [lo, hi]: readonly [number, number]) => (hi - lo < 1e-6 ? 50 : Math.round(((v - lo) / (hi - lo)) * 100));
  const fromPct = (p: number, [lo, hi]: readonly [number, number]) => lo + (p / 100) * (hi - lo);

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Crop your photo</DialogTitle>
          <DialogDescription>
            Drag the photo, or use the sliders, to choose the part inside the circle.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div
            ref={boxRef}
            data-crop-box
            className="relative mx-auto aspect-square w-full max-w-72 cursor-grab touch-none overflow-hidden rounded-lg bg-muted active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <CroppedPhoto chosen={chosen} view={view} className="absolute inset-0" />
            {/* The round crop: everything outside the circle is dimmed. */}
            <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgb(0_0_0/0.5)] ring-2 ring-white/80" aria-hidden />
          </div>

          <div className="grid gap-1">
            <CropSlider
              id={zoomId}
              label="Zoom"
              value={Math.round(((view.zoom - CROP_ZOOM_MIN) / (CROP_ZOOM_MAX - CROP_ZOOM_MIN)) * 100)}
              valueText={`${Math.round(view.zoom * 100)}%`}
              onChange={(p) => update({ zoom: CROP_ZOOM_MIN + (p / 100) * (CROP_ZOOM_MAX - CROP_ZOOM_MIN) })}
            />
            <CropSlider
              id={xId}
              label="Left to right"
              value={pct(view.cx, range.x)}
              valueText={canPanX ? `${pct(view.cx, range.x)}% from the left` : "The whole width is shown"}
              disabled={!canPanX}
              onChange={(p) => update({ cx: fromPct(p, range.x) })}
            />
            <CropSlider
              id={yId}
              label="Top to bottom"
              value={pct(view.cy, range.y)}
              valueText={canPanY ? `${pct(view.cy, range.y)}% from the top` : "The whole height is shown"}
              disabled={!canPanY}
              onChange={(p) => update({ cy: fromPct(p, range.y) })}
            />
          </div>

          <figure className="grid gap-2">
            <figcaption className="text-sm font-medium">Preview</figcaption>
            <ul className="flex flex-wrap items-end gap-4">
              {PREVIEW_SIZES.map((s) => (
                // Each preview is exactly the size it shows at there.
                <li key={s.px} className="grid justify-items-center gap-1 text-xs text-muted-foreground">
                  <div style={{ width: s.px, height: s.px }}>
                    <CroppedPhoto chosen={chosen} view={view} className="size-full rounded-full bg-secondary" />
                  </div>
                  <span>{s.label}</span>
                </li>
              ))}
            </ul>
          </figure>

          {error && (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" className={TOUCH} disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" className={TOUCH} aria-disabled={saving} aria-describedby={error ? errorId : undefined} onClick={() => !saving && save()}>
            {saving && <Loader2Icon className="animate-spin" aria-hidden />}
            {saving ? "Saving…" : "Save photo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CropSlider({
  id,
  label,
  value,
  valueText,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  valueText: string;
  disabled?: boolean;
  onChange: (percent: number) => void;
}) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-valuetext={valueText}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-11 w-full min-w-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}

function RemovePhotoButton({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <Button type="button" variant="outline" className={TOUCH} onClick={() => setOpen(true)}>
        <Trash2Icon aria-hidden />
        Remove photo
      </Button>
      {open && (
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            onDone();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Remove your photo?</AlertDialogTitle>
            <AlertDialogDescription>
              Your avatar shows instead, everywhere. The photo is deleted from InkBoard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={TOUCH} disabled={pending}>
              Keep photo
            </AlertDialogCancel>
            <AlertDialogAction
              className={TOUCH}
              variant="destructive"
              aria-disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                if (pending) return;
                startTransition(async () => {
                  try {
                    await removePhotoAction();
                    notify.success("Photo removed", "Your avatar shows instead.");
                    setOpen(false);
                    // This button and its dialog unmount when the page refreshes without a
                    // photo; the panel then moves focus to "Upload photo" (see hadPhoto).
                  } catch {
                    notify.error(UNEXPECTED_ERROR.title, UNEXPECTED_ERROR.description);
                  }
                });
              }}
            >
              {pending && <Loader2Icon className="animate-spin" aria-hidden />}
              Remove photo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
