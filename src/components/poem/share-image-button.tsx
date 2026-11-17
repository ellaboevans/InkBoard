"use client";

import { CopyIcon, DownloadIcon, ImageIcon, Loader2Icon, MessageCircleIcon, RotateCwIcon, Share2Icon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { notify } from "@/lib/notify";
import { shareText, whatsappShareUrl } from "@/lib/share-image/share-text";

/*
 * "Share as image" on a public poem (docs/PLAN.md, Phase 21), under the
 * byline on the reading page and in the board's overlay.
 *
 * Web Share needs the tap's user activation, and waiting on a download can
 * outlast it (about 5 s in Chromium and WebKit). So opening the sheet starts
 * loading the image (the preview is that exact file), and the Share button
 * calls navigator.share() directly in its own tap, with nothing awaited
 * first. Browsers that can't share files (most desktops, Firefox, in-app
 * browsers) get Download image, Copy link and Send on WhatsApp instead.
 *
 * The sheet's content is mounted only while it's open, so nothing is fetched
 * until a reader asks. Buttons that need the image are aria-disabled (not
 * disabled) while it loads, so Radix can focus the first one on open.
 */

type Props = {
  /** /p/<author>/<poem>/share-image */
  imagePath: string;
  /** Absolute, resolved on the server (the client has no APP_URL). */
  poemUrl: string;
  title: string;
  penName: string;
  fileName: string;
};

/** 44 px touch targets, as in the install card. */
const TOUCH = "h-11 px-4 text-[15px] [&_svg:not([class*='size-'])]:size-[18px]";

export function ShareImageButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-11 px-4 sm:h-9 sm:px-3 pointer-coarse:h-11">
          <ImageIcon aria-hidden />
          Share as image
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto p-5 sm:max-w-md"
      >
        <ShareSheet {...props} />
      </DialogContent>
    </Dialog>
  );
}

type Loaded = { status: "loading" } | { status: "ready"; file: File; url: string } | { status: "failed"; offline: boolean };

/** Whether this browser can hand an image file to the system share sheet. */
function canShareFiles(): boolean {
  try {
    if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
    return navigator.canShare({ files: [new File([new Uint8Array(8)], "inkboard.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

function ShareSheet({ imagePath, poemUrl, title, penName, fileName }: Props) {
  const [fileShare] = useState(canShareFiles);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const text = shareText({ title, penName, url: poemUrl });

  useEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;
    fetch(imagePath, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`share image: ${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], fileName, { type: "image/png" });
        url = URL.createObjectURL(file);
        setLoaded({ status: "ready", file, url });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLoaded({ status: "failed", offline: navigator.onLine === false });
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [imagePath, fileName, attempt]);

  const ready = loaded.status === "ready" ? loaded : null;

  const share = () => {
    if (!ready) return;
    const data: ShareData = { files: [ready.file], text };
    if (!navigator.canShare?.(data)) {
      notify.error("Couldn't share the image", "Download it instead, then post it from your gallery.");
      return;
    }
    // Straight from the tap, nothing awaited first (see the header).
    navigator.share(data).catch((error: unknown) => {
      // Closing the share sheet isn't an error.
      if (error instanceof DOMException && error.name === "AbortError") return;
      notify.error("Couldn't share the image", "Download it instead, then post it from your gallery.");
    });
  };

  const download = () => {
    if (!ready) return;
    const a = document.createElement("a");
    a.href = ready.url;
    a.download = ready.file.name;
    document.body.append(a);
    a.click();
    a.remove();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(poemUrl);
      notify.success("Link copied", poemUrl);
    } catch {
      notify.error("Couldn't copy the link", poemUrl);
    }
  };

  const retry = () => {
    setLoaded({ status: "loading" });
    setAttempt((n) => n + 1);
  };

  const needsImage = { "aria-disabled": ready ? undefined : true } as const;

  return (
    <>
      <DialogHeader className="pr-10">
        <DialogTitle className="text-lg">Share as image</DialogTitle>
        <DialogDescription>
          {fileShare
            ? "A picture of the poem for your WhatsApp Status, a chat or a Story, with its InkBoard address."
            : "A picture of the poem with its InkBoard address. Download it, then post it from your gallery."}
        </DialogDescription>
      </DialogHeader>

      <div
        className="relative mx-auto aspect-[9/16] h-[min(52dvh,28rem)] max-w-full overflow-hidden rounded-xl border bg-muted"
        aria-busy={loaded.status === "loading" || undefined}
      >
        {ready ? (
          // eslint-disable-next-line @next/next/no-img-element -- a blob: preview of the exact file that will be shared
          <img
            src={ready.url}
            alt={`Preview of the image: “${title}” by ${penName}, with lines from the poem and its InkBoard address.`}
            className="size-full object-contain"
            data-share-preview
          />
        ) : loaded.status !== "failed" ? (
          <div className="flex size-full items-center justify-center">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-3 p-4 text-center">
            <p className="text-sm text-destructive">
              {loaded.offline
                ? "You're offline. Connect to the internet to make the image."
                : "Couldn't load the image. Check your connection and try again."}
            </p>
            <Button type="button" variant="outline" className={TOUCH} onClick={retry}>
              <RotateCwIcon aria-hidden />
              Try again
            </Button>
          </div>
        )}
      </div>
      <p role="status" className="sr-only">
        {loaded.status === "loading" ? "Making the image…" : ready ? "Image ready." : ""}
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {fileShare ? (
          <Button type="button" className={`${TOUCH} sm:col-span-2`} onClick={share} {...needsImage}>
            <Share2Icon aria-hidden />
            Share
          </Button>
        ) : null}
        <Button
          type="button"
          variant={fileShare ? "outline" : "default"}
          className={`${TOUCH} ${fileShare ? "" : "sm:col-span-2"}`}
          onClick={download}
          {...needsImage}
        >
          <DownloadIcon aria-hidden />
          Download image
        </Button>
        <Button type="button" variant="outline" className={TOUCH} onClick={() => void copyLink()}>
          <CopyIcon aria-hidden />
          Copy link
        </Button>
        {!fileShare && (
          <Button asChild variant="outline" className={TOUCH}>
            <a href={whatsappShareUrl(text)} target="_blank" rel="noopener noreferrer">
              <MessageCircleIcon aria-hidden />
              Send on WhatsApp
            </a>
          </Button>
        )}
      </div>

      <DialogClose asChild>
        <Button type="button" variant="ghost" size="icon" className="absolute top-2 right-2 size-11">
          <XIcon aria-hidden />
          <span className="sr-only">Close</span>
        </Button>
      </DialogClose>
    </>
  );
}
