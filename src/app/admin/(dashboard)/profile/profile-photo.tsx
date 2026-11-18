"use client";

import { ImageUpIcon, Loader2Icon } from "lucide-react";
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { AuthorPicture } from "@/components/author/author-picture";
import {
  HiddenImageInput,
  ImageCropDialog,
  RemoveImageButton,
  TOUCH,
  useImageChoice,
} from "@/components/image-upload/image-upload";
import { Button } from "@/components/ui/button";
import type { AuthorPicture as Picture } from "@/lib/author-picture";
import { formatMegabytes, PHOTO_ACCEPT, PHOTO_MAX_BYTES, PHOTO_SOURCE_MAX_BYTES } from "@/lib/photo-limits";
import { removePhotoAction, savePhotoAction } from "./photo-actions";

/*
 * Profile photo: choose (camera or library), crop to a square, preview it
 * round at the sizes it shows, save (docs/PLAN.md, Phase 22). The choosing,
 * crop step and removal are shared with novel covers
 * (src/components/image-upload/image-upload.tsx).
 */

const PREVIEWS = [
  { width: 112, label: "Author page" },
  { width: 40, label: "Board" },
  { width: 32, label: "Byline" },
] as const;

const FAIL = "Couldn't use that photo";

export function ProfilePhotoPanel({ picture }: { picture: Picture }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const { chosen, checking, choose, clear } = useImageChoice("photo", FAIL);
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
        <HiddenImageInput inputRef={inputRef} accept={PHOTO_ACCEPT} onFile={(f) => void choose(f)} data-photo-input />
        <Button ref={chooseRef} type="button" variant="outline" className={TOUCH} aria-describedby={helpId} disabled={checking} onClick={() => inputRef.current?.click()}>
          {checking ? <Loader2Icon className="animate-spin" aria-hidden /> : <ImageUpIcon aria-hidden />}
          {hasPhoto ? "Change photo" : "Upload photo"}
        </Button>
        {hasPhoto && (
          <RemoveImageButton
            copy={{
              button: "Remove photo",
              title: "Remove your photo?",
              description: "Your avatar shows instead, everywhere. The photo is deleted from InkBoard.",
              keep: "Keep photo",
              success: { title: "Photo removed", description: "Your avatar shows instead." },
            }}
            remove={removePhotoAction}
            onDone={() => chooseRef.current?.focus()}
          />
        )}
      </div>
      {chosen && (
        <ImageCropDialog
          chosen={chosen}
          aspect={1}
          shape="circle"
          previews={PREVIEWS}
          use="photo"
          fieldName="photo"
          copy={{
            title: "Crop your photo",
            description: "Drag the photo, or use the sliders, to choose the part inside the circle.",
            saveLabel: "Save photo",
            failTitle: "Couldn't save your photo",
            success: { title: "Photo saved", description: "It now shows next to your pen name." },
          }}
          save={savePhotoAction}
          onClose={clear}
          returnFocus={() => chooseRef.current?.focus()}
        />
      )}
    </section>
  );
}

const noSubscribe = () => () => {};
