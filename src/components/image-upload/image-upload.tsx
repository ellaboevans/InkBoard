"use client";

import { cn } from "cn";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { useId, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react";
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
import { notify, UNEXPECTED_ERROR } from "@/lib/notify";
import {
  clampView,
  CROP_ZOOM_MAX,
  CROP_ZOOM_MIN,
  cropFromView,
  cropPlacement,
  encodeCrop,
  initialView,
  panRange,
  panView,
  type CropView,
} from "@/lib/photo-crop";
import { PHOTO_MAX_BYTES, PHOTO_SOURCE_MAX_BYTES } from "@/lib/photo-limits";
import { photoProblemMessage, type ImageUse } from "@/lib/photo-messages";
import { shrinkPhoto } from "@/lib/photo-resize";
import { isAcceptedType, sniffImageType } from "@/lib/photo-sniff";

/*
 * Choosing, cropping and removing an uploaded image: shared by the profile
 * photo (docs/PLAN.md, Phase 22; a square shown round) and novel covers
 * (Phase 25; a book's 2:3). The crop is sent as fractions with the original
 * file (or a smaller copy the browser made when the file is over the upload
 * limit); the server applies it, so what's stored is always our own
 * processed copy.
 *
 * The crop works by dragging the picture, and equally with three named
 * sliders (zoom, left–right, up–down), which are the keyboard and screen
 * reader path. Every target is 44 px on phones.
 */

export const TOUCH = "h-11 px-4 text-[15px] sm:h-9 sm:px-3 sm:text-sm pointer-coarse:h-11";

export type Chosen = { file: File; url: string; width: number; height: number };

export type ImageActionResult = { ok: true } | { ok: false; error: string };

/**
 * The file picker's checks before the crop step: size, the real type from
 * the first bytes, and that the browser can read it. Refusals are toasts.
 */
export function useImageChoice(use: ImageUse, failTitle: string) {
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [checking, setChecking] = useState(false);

  async function choose(file: File | undefined) {
    if (!file) return;
    if (file.size > PHOTO_SOURCE_MAX_BYTES) {
      notify.error(failTitle, photoProblemMessage("source_too_large", undefined, use));
      return;
    }
    setChecking(true);
    try {
      const type = sniffImageType(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
      if (!isAcceptedType(type)) {
        notify.error(failTitle, photoProblemMessage("type", type, use));
        return;
      }
      const url = URL.createObjectURL(file);
      const size = await naturalSize(url).catch(() => null);
      if (!size) {
        URL.revokeObjectURL(url);
        notify.error(failTitle, photoProblemMessage("unreadable", undefined, use));
        return;
      }
      setChosen({ file, url, ...size });
    } finally {
      setChecking(false);
    }
  }

  function clear() {
    if (chosen) URL.revokeObjectURL(chosen.url);
    setChosen(null);
  }

  return { chosen, checking, choose, clear };
}

function naturalSize(url: string): Promise<{ width: number; height: number }> {
  // An <img> applies EXIF orientation (image-orientation: from-image), so these
  // are the picture as seen: the same space the server crops in.
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => (img.naturalWidth && img.naturalHeight ? resolve({ width: img.naturalWidth, height: img.naturalHeight }) : reject(new Error("empty")));
    img.onerror = () => reject(new Error("decode"));
    img.src = url;
  });
}

/** The picture placed so the crop fills its box (a box of the crop's aspect). */
function CroppedImage({ chosen, view, aspect, className }: { chosen: Chosen; view: CropView; aspect: number; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden", className)} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL being cropped */}
      <img src={chosen.url} alt="" draggable={false} className="absolute max-w-none select-none" style={cropPlacement(view, chosen.width, chosen.height, aspect)} />
    </div>
  );
}

export type CropPreview = { width: number; label: string };

export type CropDialogCopy = {
  title: string;
  description: string;
  saveLabel: string;
  failTitle: string;
  success: { title: string; description: string };
};

/**
 * The crop step: drag or sliders, previews at the sizes it shows, save.
 * `shape` is how the crop is framed: "circle" (a profile photo, shown round)
 * or "book" (a cover's 2:3 with a book's corners). `fieldName` is the file's
 * field in the form sent to `save` (with "crop").
 */
export function ImageCropDialog({
  chosen,
  aspect,
  shape,
  previews,
  copy,
  use,
  fieldName,
  save,
  onClose,
  returnFocus,
}: {
  chosen: Chosen;
  aspect: number;
  shape: "circle" | "book";
  previews: readonly CropPreview[];
  copy: CropDialogCopy;
  use: ImageUse;
  fieldName: string;
  save: (form: FormData) => Promise<ImageActionResult>;
  onClose: () => void;
  returnFocus: () => void;
}) {
  const { width, height } = chosen;
  const [view, setView] = useState<CropView>(() => clampView(initialView(), width, height, aspect));
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const range = panRange(view, width, height, aspect);
  const canPanX = range.x[1] - range.x[0] > 1e-6;
  const canPanY = range.y[1] - range.y[0] > 1e-6;
  const zoomId = useId();
  const xId = useId();
  const yId = useId();
  const errorId = useId();
  const round = shape === "circle";

  const update = (next: Partial<CropView>) => setView((v) => clampView({ ...v, ...next }, width, height, aspect));

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
    setView((v) => panView(v, dx, dy, box, width, height, aspect));
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.id === e.pointerId) drag.current = null;
  }

  function submit() {
    setError(null);
    startSaving(async () => {
      try {
        let file: Blob = chosen.file;
        if (file.size > PHOTO_MAX_BYTES) {
          const smaller = await shrinkPhoto(chosen.file).catch(() => null);
          if (!smaller || smaller.size > PHOTO_MAX_BYTES) {
            const message = photoProblemMessage("too_large", undefined, use);
            setError(message);
            notify.error(copy.failTitle, message);
            return;
          }
          file = smaller;
        }
        const form = new FormData();
        form.set(fieldName, file, fieldName);
        form.set("crop", encodeCrop(cropFromView(view, width, height, aspect)));
        const res = await save(form);
        if (res.ok) {
          notify.success(copy.success.title, copy.success.description);
          onClose();
        } else {
          setError(res.error);
          notify.error(copy.failTitle, res.error);
        }
      } catch {
        // Network failure or a server error: nothing was saved; the old picture stays.
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
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div
            ref={boxRef}
            data-crop-box
            data-crop-shape={shape}
            className={cn(
              "relative mx-auto w-full cursor-grab touch-none overflow-hidden rounded-lg bg-muted active:cursor-grabbing",
              round ? "max-w-72" : "max-w-52",
            )}
            style={{ aspectRatio: String(aspect) }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <CroppedImage chosen={chosen} view={view} aspect={aspect} className="absolute inset-0" />
            {round ? (
              // The round crop: everything outside the circle is dimmed.
              <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgb(0_0_0/0.5)] ring-2 ring-white/80" aria-hidden />
            ) : (
              // The whole box is the cover: a book's corners and its spine's edge.
              <div className="pointer-events-none absolute inset-0 rounded-[4px_8px_8px_4px] shadow-[inset_6px_0_0_rgb(0_0_0/0.18)] ring-2 ring-white/80 ring-inset" aria-hidden />
            )}
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
              {previews.map((s) => (
                // Each preview is exactly the size it shows at there.
                <li key={s.width} className="grid justify-items-center gap-1 text-xs text-muted-foreground">
                  <div style={{ width: s.width, height: Math.round(s.width / aspect) }}>
                    <CroppedImage
                      chosen={chosen}
                      view={view}
                      aspect={aspect}
                      className={cn("size-full bg-secondary", round ? "rounded-full" : "rounded-[4px_8px_8px_4px]")}
                    />
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
          <Button type="button" className={TOUCH} aria-disabled={saving} aria-describedby={error ? errorId : undefined} onClick={() => !saving && submit()}>
            {saving && <Loader2Icon className="animate-spin" aria-hidden />}
            {saving ? "Saving…" : copy.saveLabel}
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

export type RemoveCopy = {
  button: string;
  title: string;
  description: string;
  keep: string;
  success: { title: string; description: string };
};

/** "Remove photo" / "Remove cover", behind a confirmation; `onDone` moves focus once the dialog closes. */
export function RemoveImageButton({ copy, remove, onDone }: { copy: RemoveCopy; remove: () => Promise<unknown>; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <Button type="button" variant="outline" className={TOUCH} onClick={() => setOpen(true)}>
        <Trash2Icon aria-hidden />
        {copy.button}
      </Button>
      {open && (
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            onDone();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.title}</AlertDialogTitle>
            <AlertDialogDescription>{copy.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={TOUCH} disabled={pending}>
              {copy.keep}
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
                    await remove();
                    notify.success(copy.success.title, copy.success.description);
                    setOpen(false);
                    // This button and its dialog unmount when the page refreshes without the
                    // image; the panel then moves focus to its upload button.
                  } catch {
                    notify.error(UNEXPECTED_ERROR.title, UNEXPECTED_ERROR.description);
                  }
                });
              }}
            >
              {pending && <Loader2Icon className="animate-spin" aria-hidden />}
              {copy.button}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}

/**
 * The hidden file input behind "Upload …": opened by a real button (the
 * input itself is out of the tab order), and cleared after each pick so the
 * same file can be chosen again after a cancel.
 */
export function HiddenImageInput({
  inputRef,
  accept,
  onFile,
  ...data
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  accept: string;
  onFile: (file: File | undefined) => void;
} & Record<`data-${string}`, string | boolean>) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      {...data}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        onFile(file);
      }}
    />
  );
}
