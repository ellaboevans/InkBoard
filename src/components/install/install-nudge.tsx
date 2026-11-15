"use client";

import { cn } from "cn";
import { ArrowDownIcon, ChevronRightIcon, DownloadIcon, MonitorDownIcon, ShareIcon, SquarePlusIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { isPhoneLike, type Audience, type InstallMethod, type Platform } from "@/lib/install-nudge";
import {
  finishFold,
  getServerSnapshot,
  getSnapshot,
  gotIt,
  notNow,
  notePoemOpened,
  noteFirstPublish,
  promptInstall,
  registerSlot,
  requestInstall,
  subscribe,
  type SlotKind,
} from "@/lib/install-store";

/*
 * The "install InkBoard" nudge (docs/PLAN.md, Phase 15; look and copy:
 * docs/mockups/install-prompt/). InstallNudgeHost is rendered once by the
 * root layout and portals the card into a slot: the board's bottom column
 * (phones, with the zoom bar, so they can't overlap), under the board toolbar
 * (wide screens, hanging from the install button), or the editor's corner.
 * Everything is client-only: on the server and during hydration the store
 * says "nothing to show".
 */

export function useInstall() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Where the card may appear. Rendered by the board and the dashboard; the host portals into it. */
export function InstallSlot({ kind, className }: { kind: SlotKind; className?: string }) {
  // Stable, so React registers the element once rather than on every render.
  const ref = useCallback((el: HTMLDivElement | null) => registerSlot(kind, el), [kind]);
  return <div data-install-slot={kind} ref={ref} className={className} />;
}

export function InstallNudgeHost() {
  const s = useInstall();
  if (!s.card || !s.method) return null;
  const { audience } = s.card;
  // Writers' card lives in the editor; readers' on the board, top on wide screens.
  const kind: SlotKind | null =
    audience === "writer" && s.slots.editor
      ? "editor"
      : s.wide && s.slots["board-top"]
        ? "board-top"
        : s.slots["board-bottom"]
          ? "board-bottom"
          : s.slots.editor
            ? "editor"
            : null;
  const slot = kind && s.slots[kind];
  if (!kind || !slot) return null;
  return createPortal(
    <InstallCard
      key={kind}
      audience={audience}
      method={s.method}
      platform={s.platform}
      placement={kind}
      folding={s.folding && kind === "board-top"}
    />,
    slot,
  );
}

type Copy = { title: string; why: string };
function copyFor(audience: Audience, method: InstallMethod, platform: Platform): Copy {
  const writer = audience === "writer";
  if (method === "mac") {
    return {
      title: "Add InkBoard to your Dock",
      why: writer ? "Opens your poems in their own window." : "Opens the board in its own window.",
    };
  }
  if (method === "ios") {
    const browser = platform.kind === "ios" && platform.safari ? "Safari" : "Your browser";
    return writer
      ? { title: "Write from your home screen", why: `Your poems one tap away. ${browser} does it in two steps:` }
      : { title: "Put InkBoard on your home screen", why: `One tap to the board, full screen. ${browser} does it in two steps:` };
  }
  if (isPhoneLike(platform)) {
    return writer
      ? { title: "Write from your home screen", why: "Your poems one tap away, ready when a line arrives." }
      : { title: "Put InkBoard on your home screen", why: "One tap to the board, full screen, without the browser around it." };
  }
  return writer
    ? { title: "Install InkBoard", why: "Your poems in their own window, ready when a line arrives." }
    : { title: "Install InkBoard", why: "The board in its own window, one click away in your dock or taskbar." };
}

function shareWhere(platform: Platform) {
  if (platform.kind !== "ios" || !platform.safari) return "in your browser’s menu";
  return platform.device === "iphone" ? "in the bar below" : "at the top of the screen";
}

function InstallCard({
  audience,
  method,
  platform,
  placement,
  folding,
}: {
  audience: Audience;
  method: Exclude<InstallMethod, null>;
  platform: Platform;
  placement: SlotKind;
  folding: boolean;
}) {
  const titleId = useId();
  const cardRef = useRef<HTMLElement>(null);
  // Where keyboard focus came from, to hand it back when the card closes.
  const returnTo = useRef<HTMLElement | null>(null);
  const compact = placement === "board-top";
  const copy = copyFor(audience, method, platform);
  const pointer = method === "ios" && platform.kind === "ios" && platform.safari && platform.device === "iphone" && !compact;

  const dismiss = (action: () => void) => {
    const hadFocus = cardRef.current?.contains(document.activeElement);
    action();
    if (!hadFocus) return;
    // The focused button is going away: back to where the person came from,
    // else the toolbar button the card folds into.
    const button = document.querySelector<HTMLElement>("[data-install-button]");
    const target = returnTo.current?.isConnected ? returnTo.current : button?.checkVisibility() ? button : null;
    target?.focus({ preventScroll: true });
  };

  // Esc dismisses (like "Not now"), unless a dialog or menu is open: Esc is theirs then.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const layer = document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
      if (layer?.checkVisibility()) return;
      dismiss(notNow);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });


  const touch = compact ? undefined : "h-11 px-4 text-[15px] [&_svg:not([class*='size-'])]:size-[18px]";
  const promptButton = method === "prompt";

  return (
    <section
      ref={cardRef}
      aria-labelledby={titleId}
      data-install-card={audience}
      data-install-method={method}
      onFocus={(e) => {
        const from = e.relatedTarget;
        if (from instanceof HTMLElement && !e.currentTarget.contains(from)) returnTo.current = from;
      }}
      onAnimationEnd={(e) => {
        if (folding && e.target === e.currentTarget) finishFold();
      }}
      className={cn(
        "pointer-events-auto relative w-full rounded-2xl border bg-card/95 p-4 text-card-foreground shadow-[0_1px_2px_oklch(0_0_0/0.06),0_14px_36px_-14px_oklch(0_0_0/0.3)] backdrop-blur",
        compact ? "origin-top-right" : "max-w-[420px]",
        folding
          ? "fill-mode-forwards animate-out fade-out zoom-out-50 duration-200"
          : "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300",
      )}
    >
      {compact && (
        // Points at the toolbar install button, the last item in the toolbar.
        <span
          aria-hidden
          className="absolute -top-[7px] right-2 size-3 rotate-45 border-t border-l bg-card"
        />
      )}
      <div className="flex items-start gap-3">
        <LogoTile className="size-11 shrink-0" />
        <div className="min-w-0">
          <h2 id={titleId} className="mt-px text-[15.5px] leading-[21px] font-semibold">
            {copy.title}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{copy.why}</p>
          {method === "mac" && (
            <>
              <p className="mt-2.5 text-sm">In Safari’s menu bar, choose</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Kbd>File</Kbd>
                <ChevronRightIcon className="size-4" aria-label="then" role="img" />
                <Kbd>Add to Dock…</Kbd>
              </p>
            </>
          )}
        </div>
      </div>
      {method === "ios" && (
        <ol className="mt-3 grid gap-2">
          <Step n={1} icon={<ShareIcon />}>
            Tap <b className="font-semibold">Share</b> {shareWhere(platform)}
          </Step>
          <Step n={2} icon={<SquarePlusIcon />}>
            Choose <b className="font-semibold">Add to Home Screen</b>
          </Step>
        </ol>
      )}
      <div className={cn("mt-3.5 gap-2", compact ? "flex justify-end" : "grid grid-cols-2")}>
        <Button type="button" variant="outline" className={touch} onClick={() => dismiss(notNow)}>
          Not now
        </Button>
        {promptButton ? (
          <Button type="button" className={touch} onClick={() => void promptInstall()}>
            <DownloadIcon aria-hidden />
            Install
          </Button>
        ) : (
          <Button type="button" className={touch} onClick={() => dismiss(gotIt)}>
            Got it
          </Button>
        )}
      </div>
      {pointer && (
        <span
          data-install-pointer
          aria-hidden
          className="absolute -bottom-4 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_0_4px_var(--background),0_6px_14px_-4px_oklch(0_0_0/0.35)]"
        >
          <ArrowDownIcon className="size-[18px]" />
        </span>
      )}
    </section>
  );
}

function Step({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 text-[14.5px]">
      <span className="w-3 shrink-0 text-right text-muted-foreground tabular-nums" aria-hidden>
        {n}
      </span>
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-secondary text-secondary-foreground [&_svg]:size-[18px]"
      >
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border bg-secondary px-2 font-sans text-[13px] leading-6 font-medium text-secondary-foreground">
      {children}
    </kbd>
  );
}

/** src/app/icon.svg as markup: the Feather on the ink-red tile. */
function LogoTile({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="7" fill="#852e2c" />
      <g
        transform="translate(6.5 6.5) scale(0.79)"
        fill="none"
        stroke="#fdfaf3"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14.086 18.412A2 2 0 0112.67 19H5v-7.672a2 2 0 01.586-1.414L11.75 3.75a6 6 0 118.49 8.49z" />
        <path d="M16 8 2 22" />
        <path d="M17.488 15H9" />
      </g>
    </svg>
  );
}

/**
 * The board toolbar's install button: wide screens only (the phone toolbar is
 * at its two-row budget), and only when installing is possible here.
 */
export function InstallToolbarButton() {
  const s = useInstall();
  if (!s.method) return null;
  const open = s.card?.audience === "reader" && !s.folding;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      data-install-button=""
      data-highlight={s.pulse ? "true" : undefined}
      aria-label="Install InkBoard"
      title="Install InkBoard"
      aria-expanded={s.method === "prompt" ? undefined : open}
      onClick={() => requestInstall("reader")}
      className="bg-background/85 backdrop-blur max-sm:hidden"
    >
      <MonitorDownIcon />
    </Button>
  );
}

/** "Install app" in the editor's account menu: the native prompt, or the instructions card. */
export function InstallMenuItem() {
  const s = useInstall();
  if (!s.method) return null;
  return (
    <DropdownMenuItem onSelect={() => requestInstall("writer")}>
      <MonitorDownIcon />
      Install app
    </DropdownMenuItem>
  );
}

/** Counts a poem as opened (once per poem, so re-mounts and StrictMode don't inflate it). */
export function PoemOpened({ id }: { id: string }) {
  useEffect(() => notePoemOpened(id), [id]);
  return null;
}

/**
 * After a redirect with `?first-publish=1`: arm the writer card once, then
 * strip the param (the ref guards StrictMode and <Activity> re-shows).
 */
export function FirstPublishFlash({ active }: { active: boolean }) {
  const done = useRef(false);
  useEffect(() => {
    if (!active || done.current) return;
    done.current = true;
    noteFirstPublish();
    const url = new URL(window.location.href);
    url.searchParams.delete("first-publish");
    window.history.replaceState(window.history.state, "", url);
  }, [active]);
  return null;
}
