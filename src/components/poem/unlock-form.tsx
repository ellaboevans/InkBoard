"use client";

import { EyeIcon, EyeOffIcon, Loader2Icon, LockIcon } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify, withErrorToast } from "@/lib/notify";
import type { UnlockState } from "./unlock-actions";

export function UnlockForm({
  action,
  penName,
  sharedPassword,
}: {
  action: (prev: UnlockState, formData: FormData) => Promise<UnlockState>;
  penName: string;
  sharedPassword: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    withErrorToast(async (prev: UnlockState, formData: FormData) => {
      const next = await action(prev, formData);
      if (next.error) {
        notify.error("Couldn't unlock this poem", next.error);
      } else {
        notify.success(
          "Poem unlocked",
          sharedPassword
            ? `All of ${penName}'s private poems are open on this device for 12 hours.`
            : "It stays open on this device for 12 hours.",
        );
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
        <p className="font-serif text-xl">This poem is password protected</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {sharedPassword
            ? `${penName} uses one password for all their private poems. Entering it unlocks them all.`
            : `Ask ${penName} for this poem's password.`}
        </p>
      </div>
      <form action={formAction} className="grid w-full max-w-xs gap-2 text-left">
        <Label htmlFor="poem-password">Password</Label>
        <div className="relative">
          <Input
            id="poem-password"
            name="password"
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? "poem-password-error" : undefined}
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
          <p id="poem-password-error" role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        <Button type="submit" disabled={pending || !password} className="mt-1">
          {pending && <Loader2Icon className="animate-spin" />}
          Unlock poem
        </Button>
      </form>
    </div>
  );
}
