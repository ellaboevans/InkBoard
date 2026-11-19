"use client";

import { useSyncExternalStore } from "react";
import { scheduleLabel } from "@/lib/chapter-schedule";

const noSubscribe = () => () => {};

/**
 * A scheduled chapter's time, in the writer's own time zone (Phase 28). Only
 * the browser knows that zone, so the server renders the instant without a
 * label (the `<time>` element and `fallback`) and the label appears after
 * hydration: useSyncExternalStore's server snapshot is null, so the HTML and
 * the first client render agree and nothing mismatches (the novel page's
 * "Continue" works the same way).
 */
export function ScheduledTime({ iso, prefix = "", fallback = "" }: { iso: string; prefix?: string; fallback?: string }) {
  const label = useSyncExternalStore(
    noSubscribe,
    () => scheduleLabel(new Date(iso), new Date()),
    () => null,
  );
  return (
    <time dateTime={iso} data-scheduled-time={iso}>
      {label === null ? fallback : `${prefix}${label}`}
    </time>
  );
}
