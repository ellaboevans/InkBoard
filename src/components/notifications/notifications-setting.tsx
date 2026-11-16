"use client";

import { BellRingIcon, ChevronDownIcon } from "lucide-react";
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
  getServerSnapshot,
  getSnapshot,
  subscribe,
  turnOff,
  turnOn,
} from "@/lib/push-store";

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
  "When you turn notifications on, your browser gives InkBoard a delivery address for this device, issued by your browser’s push service (Google, Apple, Mozilla or Microsoft). We store that address, the keys that encrypt messages to it, and when we last sent to it. We don’t store your name, email or location, we don’t record what you read, and the address isn’t linked to an InkBoard account. Each notification carries only a poem’s title and its author’s name, travels encrypted through your browser’s push service, and is never sent for private poems. Turn notifications off here or in your browser’s settings and we delete the address. Addresses that stop working, or that we haven’t been able to use for 90 days, are deleted automatically.";

export function usePush() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function NotificationsSetting({ className, onTurnedOn }: { className?: string; onTurnedOn?: () => void }) {
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
      {how}
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
      <NotificationsSetting onTurnedOn={finishOffer} />
      <div className="mt-3 flex justify-end">
        <Button type="button" variant="outline" className={phone ? "h-11 px-4" : undefined} onClick={finishOffer}>
          Not now
        </Button>
      </div>
    </section>,
    slot,
  );
}
