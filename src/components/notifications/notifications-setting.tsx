"use client";

import { BellIcon, BellRingIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { useId, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { useInstall } from "@/components/install/install-nudge";
import type { SlotKind } from "@/lib/install-store";
import {
  finishOffer,
  follow,
  getServerSnapshot,
  getSnapshot,
  setMode,
  subscribe,
  turnOff,
  turnOn,
  unfollow,
} from "@/lib/push-store";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

/*
 * "Notifications on this device" (docs/PLAN.md, Phase 18): a switch with the
 * owner's privacy wording, in the Subscribe popover and in the one-time
 * offer after installing. Permission is requested only from the switch.
 * Renders nothing until the browser has been read, or when the server has no
 * VAPID key.
 */

/** The owner's wording: keep the meaning as written. */
export const NOTIFICATIONS_SHORT =
  "Get a notification on this device when a new poem is published. We keep only what your browser needs to reach this device: no name, no email. Turn it off here any time.";
export const NOTIFICATIONS_FULL =
  "When you turn notifications on, your browser gives InkBoard a delivery address for this device, issued by your browser’s push service (Google, Apple, Mozilla or Microsoft). We store that address, the keys that encrypt messages to it, and when we last sent to it. If you follow authors, we also store which authors this device follows. We don’t store your name, email or location, we don’t record what you read, and the address isn’t linked to an InkBoard account. Each notification carries only a poem’s title and its author’s name, travels encrypted through your browser’s push service, and is never sent for private poems. Turn notifications off here or in your browser’s settings and we delete the address. Addresses that stop working, or that we haven’t been able to use for 90 days, are deleted automatically.";

export function usePush() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function NotificationsSetting({
  className,
  onTurnedOn,
  showPrefs = true,
}: {
  className?: string;
  onTurnedOn?: () => void;
  /** The mode and followed authors (the popover); the after-install offer leaves them out. */
  showPrefs?: boolean;
}) {
  const s = usePush();
  const switchId = useId();
  const shortId = useId();
  const stateId = useId();
  if (s.status === "unavailable") return null;

  const label = <span className="text-sm font-medium">Notifications on this device</span>;
  const how = (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="link" size="sm" className="group h-auto px-0 text-foreground">
          How notifications work
          <ChevronDownIcon aria-hidden className="transition-transform group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="text-sm text-muted-foreground">{NOTIFICATIONS_FULL}</p>
      </CollapsibleContent>
    </Collapsible>
  );

  if (s.status === "ios-install" || s.status === "unsupported") {
    return (
      <div className={cn("grid gap-1.5", className)} data-push-setting={s.status}>
        {label}
        <p className="text-sm text-muted-foreground">
          {s.status === "ios-install"
            ? "On iPhone and iPad, notifications work in the InkBoard app. Add InkBoard to your Home Screen first: tap Share, then Add to Home Screen, and open InkBoard from there."
            : "This browser can’t show notifications from websites. The feed works in any feed reader."}
        </p>
        {s.status === "ios-install" && how}
      </div>
    );
  }

  const on = s.status === "on";
  const blocked = s.status === "blocked";
  return (
    <div className={cn("grid gap-1.5", className)} data-push-setting={s.status} aria-busy={s.busy || undefined}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={switchId}>{label}</label>
        <Switch
          id={switchId}
          checked={on}
          disabled={blocked}
          aria-describedby={blocked ? `${stateId} ${shortId}` : shortId}
          onCheckedChange={(checked) => {
            if (checked) void turnOn().then(() => getSnapshot().status === "on" && onTurnedOn?.());
            else void turnOff();
          }}
        />
      </div>
      {blocked && (
        <p id={stateId} className="text-sm font-medium">
          Notifications are blocked for InkBoard in this browser. To use them, allow notifications for this site in your
          browser’s site settings, then come back here.
        </p>
      )}
      <p id={shortId} className="text-sm text-muted-foreground">
        {NOTIFICATIONS_SHORT}
      </p>
      {on && showPrefs && <DevicePrefsEditor />}
      {how}
    </div>
  );
}

/** "All new poems" / "Only authors I follow", and the followed authors with Unfollow buttons. */
function DevicePrefsEditor() {
  const s = usePush();
  const legendId = useId();
  const listId = useId();
  if (!s.prefs) return <p className="text-sm text-muted-foreground">Loading your choices…</p>;
  const { mode, follows } = s.prefs;
  return (
    <div className="grid gap-2 rounded-md border p-2.5" data-push-prefs={mode}>
      <span id={legendId} className="text-sm font-medium">
        Notify me about
      </span>
      <RadioGroup
        aria-labelledby={legendId}
        value={mode}
        onValueChange={(v) => void setMode(v === "followed" ? "followed" : "all")}
        className="gap-1.5"
      >
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="all" />
          All new poems
        </label>
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="followed" />
          Only authors I follow
        </label>
      </RadioGroup>
      <span id={listId} className="mt-1 text-sm font-medium">
        Authors you follow
      </span>
      {follows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None yet. Follow an author from their page{mode === "followed" ? " to hear about their new poems" : ""}.
        </p>
      ) : (
        <ul aria-labelledby={listId} className="grid gap-1">
          {follows.map((f) => (
            <li key={f.slug} className="flex min-w-0 items-center justify-between gap-2 text-sm">
              <a href={`/a/${f.slug}`} className="min-w-0 truncate underline-offset-4 hover:underline">
                {f.penName}
              </a>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2"
                aria-label={`Unfollow ${f.penName}`}
                onClick={() => void unfollow(f.slug)}
              >
                <XIcon aria-hidden />
                Unfollow
              </Button>
            </li>
          ))}
        </ul>
      )}
      {mode === "followed" && follows.length === 0 && (
        <p className="text-sm text-muted-foreground">Until you follow someone, this device gets no notifications.</p>
      )}
    </div>
  );
}

/**
 * "Notify me about new poems by <pen name>" on an author's page (Phase 18
 * round 2). Following with notifications off turns them on in "Only authors
 * I follow"; that tap is the permission request. iPhone/iPad outside the
 * Home Screen app get the "Add to Home Screen first" note instead.
 */
export function FollowAuthorToggle({ slug, penName }: { slug: string; penName: string }) {
  const s = usePush();
  const noteId = useId();
  if (s.status === "unavailable" || s.status === "unsupported") return null;
  if (s.status === "ios-install") {
    return (
      <p className="text-sm text-muted-foreground" data-follow-author="ios-install">
        To get notified about {penName}’s new poems on iPhone or iPad, add InkBoard to your Home Screen first: tap Share,
        then Add to Home Screen, and open InkBoard from there.
      </p>
    );
  }
  const following = s.status === "on" && Boolean(s.prefs?.follows.some((f) => f.slug === slug));
  const blocked = s.status === "blocked";
  const note = blocked
    ? "Notifications are blocked for InkBoard in this browser: allow them in your browser’s site settings first."
    : following && s.prefs?.mode === "all"
      ? "This device gets every new poem; choose “Only authors I follow” under Subscribe to hear only from authors you follow."
      : null;
  return (
    <div className="grid justify-items-start gap-1" data-follow-author={following ? "on" : s.status}>
      <Button
        type="button"
        variant={following ? "secondary" : "outline"}
        size="sm"
        // Long pen names wrap instead of pushing past the page's edge on phones.
        className="h-auto min-h-8 max-w-full py-1.5 text-left whitespace-normal"
        aria-pressed={following}
        aria-disabled={blocked || s.busy || (s.status === "on" && !s.prefs) || undefined}
        aria-describedby={note ? noteId : undefined}
        onClick={() => {
          if (blocked || s.busy || (s.status === "on" && !s.prefs)) return;
          void (following ? unfollow(slug) : follow(slug));
        }}
      >
        {following ? <BellRingIcon aria-hidden /> : <BellIcon aria-hidden />}
        Notify me about new poems by {penName}
      </Button>
      {note && (
        <p id={noteId} className="text-sm text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * After installing (the install flow's `appinstalled`, or running as the
 * installed app), offer notifications once, with the same switch. Shown only
 * while the person hasn't decided (permission still "default") and until they
 * turn it on or choose "Not now". It's a card, never a permission prompt.
 */
export function NotificationsOfferHost() {
  const install = useInstall();
  const push = usePush();
  const titleId = useId();
  const show =
    install.installed &&
    !install.card &&
    !push.offerDone &&
    push.status === "off" &&
    push.permission === "default";
  if (!show) return null;
  const kind: SlotKind | null =
    install.wide && install.slots["board-top"]
      ? "board-top"
      : install.slots["board-bottom"]
        ? "board-bottom"
        : install.slots.editor
          ? "editor"
          : null;
  const slot = kind && install.slots[kind];
  if (!slot) return null;
  const phone = kind === "board-bottom";
  return createPortal(
    <section
      aria-labelledby={titleId}
      data-push-offer
      className={cn(
        "pointer-events-auto w-full rounded-2xl border bg-card/95 p-4 text-card-foreground shadow-[0_1px_2px_oklch(0_0_0/0.06),0_14px_36px_-14px_oklch(0_0_0/0.3)] backdrop-blur motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300",
        kind === "board-top" ? "max-w-80" : "max-w-[420px]",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <BellRingIcon aria-hidden className="size-5 text-primary" />
        <h2 id={titleId} className="text-[15.5px] leading-[21px] font-semibold">
          Get notified about new poems
        </h2>
      </div>
      <NotificationsSetting onTurnedOn={finishOffer} showPrefs={false} />
      <div className="mt-3 flex justify-end">
        <Button type="button" variant="outline" className={phone ? "h-11 px-4" : undefined} onClick={finishOffer}>
          Not now
        </Button>
      </div>
    </section>,
    slot,
  );
}
