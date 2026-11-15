"use client";

import { KeyRoundIcon, Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { PublicDeviceCheckbox } from "@/components/auth/public-device-checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify, withErrorToast } from "@/lib/notify";
import { recoverySignInAction, type RecoverySignInState } from "../actions";

/**
 * Email + recovery code. Inputs are controlled (React resets uncontrolled
 * fields after an action), so a typo can be fixed without retyping.
 */
export function RecoverySignInForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [publicDevice, setPublicDevice] = useState(false);
  const [state, formAction, pending] = useActionState(
    withErrorToast(async (prev: RecoverySignInState, formData: FormData) => {
      const next = await recoverySignInAction(prev, formData);
      if (next.error) notify.error("Couldn't sign you in", next.error);
      return next;
    }),
    {},
  );

  return (
    <div className="grid gap-6">
      <form action={formAction} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="recovery-email">Email</Label>
          <Input
            id="recovery-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="recovery-code">Recovery code</Label>
          <Input
            id="recovery-code"
            name="code"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX"
            maxLength={40}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={state.error ? true : undefined}
            aria-describedby="recovery-code-hint"
            className="font-mono tracking-wider uppercase slashed-zero placeholder:normal-case"
            required
          />
          <p id="recovery-code-hint" className="text-xs text-muted-foreground">
            12 letters and digits. Dashes, spaces and capitals don&apos;t matter.
          </p>
        </div>

        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}

        <PublicDeviceCheckbox checked={publicDevice} onCheckedChange={setPublicDevice} />

        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : <KeyRoundIcon />}
          Sign in with recovery code
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        Have your email?{" "}
        <Link href="/sign-in" className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
          Sign in with an email code
        </Link>
      </p>
    </div>
  );
}
