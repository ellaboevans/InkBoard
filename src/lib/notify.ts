"use client";

import { unstable_rethrow } from "next/navigation";
import { sileo } from "sileo";

/**
 * Human-readable action feedback, shown as a toast at the top centre.
 * Keep titles short (they sit in a pill); put detail in `description`.
 * Inline field errors stay next to their inputs as well: toasts are
 * announced but not focusable, so they must never be the only feedback.
 */
type Detail = string | undefined;

export const notify = {
  success: (title: string, description?: Detail) => sileo.success({ title, description }),
  error: (title: string, description?: Detail) => sileo.error({ title, description }),
  warning: (title: string, description?: Detail) => sileo.warning({ title, description }),
  info: (title: string, description?: Detail) => sileo.info({ title, description }),
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
