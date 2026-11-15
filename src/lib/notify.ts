"use client";

import { unstable_rethrow } from "next/navigation";
import { sileo, type SileoOptions } from "sileo";

/**
 * Human-readable action feedback, shown as a toast at the top centre.
 * Keep titles short (they sit in a pill); put detail in `description`.
 * Inline field errors stay next to their inputs as well: toasts are
 * announced but not focusable, so they must never be the only feedback.
 */
type Detail = string | undefined;

/*
 * Every toast gets its own id. Sileo otherwise gives them all "sileo-default",
 * and a toast created while the previous one is leaving (its 600 ms exit) is
 * removed by that old toast's exit timer, which filters by id: the new message
 * silently never shows (e.g. "Poem published" right after "You're all set").
 * With distinct ids, back-to-back toasts stack instead of replacing each other.
 */
// `id` isn't in Sileo's published types, but createToast reads it (sileo is pinned
// to 0.1.6 in package.json; re-check this when upgrading).
let toastCount = 0;
const options = (title: string, description: Detail): SileoOptions => {
  const withId: SileoOptions & { id: string } = { id: `notify-${++toastCount}`, title, description };
  return withId;
};

export const notify = {
  success: (title: string, description?: Detail) => sileo.success(options(title, description)),
  error: (title: string, description?: Detail) => sileo.error(options(title, description)),
  warning: (title: string, description?: Detail) => sileo.warning(options(title, description)),
  info: (title: string, description?: Detail) => sileo.info(options(title, description)),
};

/** Shown when a Server Action throws (network failure, server bug). */
export const UNEXPECTED_ERROR = {
  title: "Something went wrong",
  description: "Your change wasn't saved. Please try again in a moment.",
} as const;

/**
 * Wrap a `useActionState` action so that an unexpected throw becomes a
 * toast plus a safe state, instead of crashing the page into an error
 * boundary and losing what the user typed.
 */
export function withErrorToast<S, A extends unknown[]>(
  action: (prev: S, ...args: A) => Promise<S>,
): (prev: S, ...args: A) => Promise<S> {
  return async (prev, ...args) => {
    try {
      return await action(prev, ...args);
    } catch (err) {
      // redirect()/notFound() are implemented as throws; let Next handle them.
      unstable_rethrow(err);
      notify.error(UNEXPECTED_ERROR.title, UNEXPECTED_ERROR.description);
      return prev;
    }
  };
}
