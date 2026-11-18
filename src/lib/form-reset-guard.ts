/*
 * Radix controls inside a <form action> (CLAUDE.md, "Client patterns").
 *
 * Radix's Switch, Checkbox and RadioGroup listen for their form's `reset`
 * event and answer it by setting themselves back to their value *at mount*,
 * through onCheckedChange / onValueChange, even when controlled. React resets
 * a <form action> after every action, so on a form that stays mounted (the
 * poem editor after "Save changes", a novel's details, a failed sign-in) the
 * control jumped back to its first value and the next submit sent that:
 * a poem made private became public again on its second save.
 *
 * The guard marks the moment of a reset (a capture listener on the form,
 * which runs before Radix's own listener there) and drops the change it
 * fires. Framework-free so it can be tested; the React side is
 * src/hooks/use-form-reset-guard.ts and src/components/form-controls.tsx.
 */

export type ResetGuard = {
  /** Watch this form's resets; returns the cleanup. */
  listen(form: EventTarget): () => void;
  /** `fn`, except while a reset is being dispatched. */
  ignoringReset<A extends unknown[]>(fn: ((...args: A) => void) | undefined): (...args: A) => void;
};

export function createResetGuard(): ResetGuard {
  let resetting = false;
  const onReset = () => {
    resetting = true;
    // Radix answers synchronously, inside the same dispatch.
    queueMicrotask(() => {
      resetting = false;
    });
  };
  return {
    listen(form) {
      form.addEventListener("reset", onReset, { capture: true });
      return () => form.removeEventListener("reset", onReset, { capture: true });
    },
    ignoringReset(fn) {
      return (...args) => {
        if (!resetting) fn?.(...args);
      };
    },
  };
}
