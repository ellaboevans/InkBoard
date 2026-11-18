"use client";

import { ImageUpIcon, Loader2Icon } from "lucide-react";
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import {
  HiddenImageInput,
  ImageCropDialog,
  RemoveImageButton,
  TOUCH,
  useImageChoice,
} from "@/components/image-upload/image-upload";
import { NovelCover } from "@/components/novel/novel-cover";
import { Button } from "@/components/ui/button";
import { COVER_ASPECT, formatMegabytes, PHOTO_ACCEPT, PHOTO_MAX_BYTES, PHOTO_SOURCE_MAX_BYTES } from "@/lib/photo-limits";
import { removeCoverAction, saveCoverAction } from "./cover-actions";

/*
 * A novel's cover in its details (docs/PLAN.md, Phase 25): the drawn cover
 * by default; "Upload cover" picks a picture (camera or library), the 2:3
 * crop step and previews at the sizes it shows, then save; "Remove cover"
 * goes back to the drawn one and deletes the files. The same choosing, crop
 * step and removal as the profile photo (src/components/image-upload/).
 */

const PREVIEWS = [
  { width: 112, label: "Novel page" },
  { width: 84, label: "Board" },
  { width: 40, label: "List" },
] as const;

export function CoverPanel({
  novelId,
  title,
  penName,
  hue,
  lang,
  coverKey,
}: {
  novelId: string;
  title: string;
  penName: string;
  hue: number;
  lang: string | null;
  coverKey: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const { chosen, checking, choose, clear } = useImageChoice("cover", "Couldn't use that picture");
  const hasCover = coverKey !== null;
  const helpId = useId();
  // True once hydrated: the file input's handler exists (E2E waits for data-ready).
  const ready = useSyncExternalStore(noSubscribe, () => true, () => false);
  // After "Remove cover" its button is gone: focus "Upload cover".
  const hadCover = useRef(hasCover);
  useEffect(() => {
    const removed = hadCover.current && !hasCover;
    hadCover.current = hasCover;
    if (!removed) return;
    const t = setTimeout(() => chooseRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [hasCover]);

  return (
    <div role="group" aria-labelledby="cover-heading" data-cover-panel data-ready={ready ? "true" : undefined} className="grid gap-3 rounded-lg border p-4">
      <div className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-4">
        <NovelCover title={title} penName={penName} hue={hue} lang={lang} coverKey={coverKey} width={72} className="w-[72px] text-[11px]" />
        <div className="grid min-w-0 gap-1">
          <h3 id="cover-heading" className="text-sm font-medium">
            Cover
          </h3>
          <p id={helpId} className="text-sm text-muted-foreground">
            {hasCover
              ? "Your picture, cropped to a book's shape. Readers see it everywhere the novel shows, even when the novel is private."
              : "A cover drawn from the title. Upload a picture instead: JPEG, PNG or WebP"}
            {!hasCover && <>, up to {formatMegabytes(PHOTO_SOURCE_MAX_BYTES)} (bigger than {formatMegabytes(PHOTO_MAX_BYTES)} is made smaller on your device first).</>}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <HiddenImageInput inputRef={inputRef} accept={PHOTO_ACCEPT} onFile={(f) => void choose(f)} data-cover-input />
        <Button ref={chooseRef} type="button" variant="outline" className={TOUCH} aria-describedby={helpId} disabled={checking} onClick={() => inputRef.current?.click()}>
          {checking ? <Loader2Icon className="animate-spin" aria-hidden /> : <ImageUpIcon aria-hidden />}
          {hasCover ? "Change cover" : "Upload cover"}
        </Button>
        {hasCover && (
          <RemoveImageButton
            copy={{
              button: "Remove cover",
              title: "Remove this cover?",
              description: "The drawn cover shows instead, everywhere. The picture is deleted from InkBoard.",
              keep: "Keep cover",
              success: { title: "Cover removed", description: "The drawn cover shows instead." },
            }}
            remove={() => removeCoverAction(novelId)}
            onDone={() => chooseRef.current?.focus()}
          />
        )}
      </div>
      {chosen && (
        <ImageCropDialog
          chosen={chosen}
          aspect={COVER_ASPECT}
          shape="book"
          previews={PREVIEWS}
          use="cover"
          fieldName="cover"
          copy={{
            title: "Crop the cover",
            description: "Drag the picture, or use the sliders, to choose the part that makes the cover.",
            saveLabel: "Save cover",
            failTitle: "Couldn't save the cover",
            success: { title: "Cover saved", description: "Readers see it on the board and the novel's page." },
          }}
          save={(form) => saveCoverAction(novelId, form)}
          onClose={clear}
          returnFocus={() => chooseRef.current?.focus()}
        />
      )}
    </div>
  );
}

const noSubscribe = () => () => {};
