"use client";

import { FingerprintIcon, Loader2Icon } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { notify, UNEXPECTED_ERROR } from "@/lib/notify";
import { useWebAuthnSupport } from "@/lib/webauthn-client";
import { dismissPasskeyOfferAction } from "./profile/passkey-actions";
import { useAddPasskey } from "./profile/use-add-passkey";

/**
 * After a recovery-code sign-in on a computer that isn't public, offer once
 * to add a passkey here (docs/PLAN.md, Phase 16 round 2): the editor's own
 * laptop, with their email on a phone they don't have. The server decides
 * whether to render it (shouldOfferPasskey); this hides it where the browser
 * can't make passkeys. "Not now" is stored on the session.
 */
export function PasskeyOffer() {
  const webauthn = useWebAuthnSupport();
  const [dismissing, startTransition] = useTransition();
  const { add, pending } = useAddPasskey({
    // Only if the ten minutes after the recovery sign-in ran out meanwhile.
    onStepUp: () => notify.info("Confirm it's you first", "Open your profile to add a passkey."),
  });
  if (!webauthn) return null;

  const dismiss = () =>
    startTransition(async () => {
      try {
        await dismissPasskeyOfferAction();
      } catch {
        notify.error(UNEXPECTED_ERROR.title, UNEXPECTED_ERROR.description);
      }
    });

  return (
    <section
      aria-labelledby="passkey-offer-title"
      className="flex flex-col gap-4 rounded-xl border border-primary/30 bg-card p-5 sm:flex-row sm:items-center"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
        <FingerprintIcon className="size-5" aria-hidden />
      </span>
      <div className="grid min-w-0 flex-1 gap-1">
        <h2 id="passkey-offer-title" className="font-medium">
          Add a passkey on this computer?
        </h2>
        <p className="text-sm text-muted-foreground">
          You signed in with a recovery code. With a passkey, this computer signs you in next time with your fingerprint,
          face or PIN: no email, no codes.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={pending || dismissing} onClick={add}>
          {pending ? <Loader2Icon className="animate-spin" /> : <FingerprintIcon />}
          Add a passkey
        </Button>
        <Button type="button" variant="ghost" disabled={pending || dismissing} onClick={dismiss}>
          Not now
        </Button>
      </div>
    </section>
  );
}
