"use client";

import { EyeIcon, EyeOffIcon, Loader2Icon, LockIcon } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify, withErrorToast } from "@/lib/notify";
import type { UnlockState } from "./unlock-actions";

/** What the form says, per kind: a poem, or a private novel (Phase 25: one password for every chapter). */
const COPY = {
  poem: {
    heading: "This poem is password protected",
    ask: (penName: string) => `Ask ${penName} for this poem's password.`,
    shared: (penName: string) => `${penName} uses one password for all their private poems. Entering it unlocks them all.`,
    button: "Unlock poem",
    failed: "Couldn't unlock this poem",
    done: "Poem unlocked",
    stays: "It stays open on this device for 12 hours.",
    sharedStays: (penName: string) => `All of ${penName}'s private poems are open on this device for 12 hours.`,
  },
  novel: {
    heading: "This novel is password protected",
    ask: (penName: string) => `Ask ${penName} for this novel's password. It opens every chapter.`,
    shared: (penName: string) =>
      `${penName} uses one password for all their private poems and novels. Entering it unlocks them all.`,
    button: "Unlock novel",
    failed: "Couldn't unlock this novel",
    done: "Novel unlocked",
    stays: "Every chapter stays open on this device for 12 hours.",
    sharedStays: (penName: string) => `All of ${penName}'s private poems and novels are open on this device for 12 hours.`,
  },
};

/** English UI whatever the poem's or novel's language: only the text it unlocks gets `lang`. */
export function UnlockForm({
  action,
  penName,
  sharedPassword,
  kind = "poem",
}: {
  action: (prev: UnlockState, formData: FormData) => Promise<UnlockState>;
  penName: string;
  sharedPassword: boolean;
  kind?: "poem" | "novel";
}) {
  const copy = COPY[kind];
  const inputId = `${kind}-password`;
  const [state, formAction, pending] = useActionState(
    withErrorToast(async (prev: UnlockState, formData: FormData) => {
      const next = await action(prev, formData);
      if (next.error) {
        notify.error(copy.failed, next.error);
      } else {
        notify.success(copy.done, sharedPassword ? copy.sharedStays(penName) : copy.stays);
      }
      return next;
    }),
    {},
  );
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border bg-card px-6 py-12 text-center">
      <LockIcon className="size-7 text-muted-foreground" aria-hidden />
      <div className="grid gap-1">
        <p className="font-serif text-xl">{copy.heading}</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {sharedPassword ? copy.shared(penName) : copy.ask(penName)}
        </p>
      </div>
      <form action={formAction} className="grid w-full max-w-xs gap-2 text-left">
        <Label htmlFor={inputId}>Password</Label>
        <div className="relative">
          <Input
            id={inputId}
            name="password"
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? `${inputId}-error` : undefined}
            required
            autoFocus
            className="pr-9"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 right-1 -translate-y-1/2"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
          >
            {show ? <EyeOffIcon /> : <EyeIcon />}
          </Button>
        </div>
        {state.error && (
          <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        <Button type="submit" disabled={pending || !password} className="mt-1">
          {pending && <Loader2Icon className="animate-spin" />}
          {copy.button}
        </Button>
      </form>
    </div>
  );
}
