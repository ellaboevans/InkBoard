"use client";

import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { PublicDeviceCheckbox } from "@/components/auth/public-device-checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { notify, withErrorToast } from "@/lib/notify";
import { linkSignInAction, type LinkSignInState } from "../actions";

export function LinkSignInForm() {
  const [publicDevice, setPublicDevice] = useState(false);
  const [state, formAction, pending] = useActionState(
    withErrorToast(async (prev: LinkSignInState, formData: FormData) => {
      // Read the token only now, on a deliberate click (see page.tsx).
      formData.set("token", window.location.hash.slice(1));
      const next = await linkSignInAction(prev, formData);
      if (next.error) notify.error("Couldn't sign you in", next.error);
      return next;
    }),
    {},
  );

  return (
    <div className="grid gap-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.error ? (
        <Button asChild className="w-full">
          <Link href="/sign-in">Request a new sign-in email</Link>
        </Button>
      ) : (
        <form action={formAction} className="grid gap-4">
          <PublicDeviceCheckbox checked={publicDevice} onCheckedChange={setPublicDevice} disabled={pending} />
          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" />}
            Continue to InkBoard
          </Button>
        </form>
      )}
      <p className="text-center text-sm text-muted-foreground">
        Didn&apos;t ask to sign in? Close this page. Nothing happens unless you continue.
      </p>
    </div>
  );
}
