"use client";

import {
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  WebAuthnAbortService,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { FingerprintIcon, Loader2Icon } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { notify, UNEXPECTED_ERROR } from "@/lib/notify";
import { PASSKEY_SIGN_IN_FAILED } from "@/lib/passkey-messages";
import { isCancelled, useWebAuthnSupport } from "@/lib/webauthn-client";
import { finishPasskeySignInAction } from "./actions";

/**
 * "Sign in with a passkey" on /sign-in (docs/PLAN.md, Phase 16 round 2):
 * usernameless (discoverable credentials), plus the browser's autofill on the
 * email field (`autocomplete="email webauthn"`) where conditional UI is
 * supported. Nothing renders without WebAuthn. "This isn't my device"
 * applies: its current value is read when the ceremony finishes.
 *
 * Only one WebAuthn request can be open at a time: pressing the button aborts
 * the autofill request (SimpleWebAuthn's abort service), and autofill starts
 * again once the button's attempt is over. A closed or cancelled prompt
 * isn't an error and shows nothing.
 */
/**
 * Sign-in options from POST /sign-in/passkey/options (null when this client
 * is over its limit). A plain fetch, not a Server Action: the autofill asks on
 * page load, and a Server Action in flight then made Next's router restore the
 * URL it started from, undoing a flash param just stripped by replaceState
 * (`/sign-in?signed-out=1` came back after "Signed out").
 */
async function fetchSignInOptions(): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const res = await fetch("/sign-in/passkey/options", { method: "POST", cache: "no-store" });
  return res.ok ? ((await res.json()) as PublicKeyCredentialRequestOptionsJSON) : null;
}

export function PasskeySignIn({ publicDevice }: { publicDevice: boolean }) {
  const webauthn = useWebAuthnSupport();
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [pending, startTransition] = useTransition();
  const publicDeviceRef = useRef(publicDevice);
  useEffect(() => {
    publicDeviceRef.current = publicDevice;
  }, [publicDevice]);

  /** On success the action redirects (to the dashboard); otherwise it returns the one message. */
  const finish = async (response: AuthenticationResponseJSON) => {
    const res = await finishPasskeySignInAction(response, publicDeviceRef.current);
    if (res.error) {
      setError(res.error);
      notify.error("Couldn't sign you in", res.error);
    }
  };

  // Autofill (conditional UI): passkeys offered in the email field's suggestions.
  useEffect(() => {
    if (!webauthn) return;
    let active = true;
    void (async () => {
      if (!(await browserSupportsWebAuthnAutofill())) return;
      const options = await fetchSignInOptions();
      if (!options || !active) return;
      let response: AuthenticationResponseJSON;
      try {
        response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: true });
      } catch {
        // Aborted (the button took over, or we left the page) or dismissed: nothing to say.
        return;
      }
      if (active) startTransition(() => finish(response));
    })().catch(() => {});
    return () => {
      active = false;
      WebAuthnAbortService.cancelCeremony();
    };
  }, [webauthn, round]);

  const signIn = () =>
    startTransition(async () => {
      setError(null);
      try {
        const options = await fetchSignInOptions();
        if (!options) {
          setError("Too many attempts from this network. Try again in a few minutes, or use your email.");
          return;
        }
        let response: AuthenticationResponseJSON;
        try {
          response = await startAuthentication({ optionsJSON: options });
        } catch (err) {
          if (!isCancelled(err)) {
            setError(PASSKEY_SIGN_IN_FAILED);
            notify.error("Couldn't sign you in", PASSKEY_SIGN_IN_FAILED);
          }
          setRound((r) => r + 1);
          return;
        }
        await finish(response);
        setRound((r) => r + 1);
      } catch (err) {
        // redirect() on success is a throw; let Next handle it.
        unstable_rethrow(err);
        notify.error(UNEXPECTED_ERROR.title, "Please try again in a moment.");
      }
    });

  if (!webauthn) return null;
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button type="button" variant="outline" size="lg" disabled={pending} onClick={signIn}>
        {pending ? <Loader2Icon className="animate-spin" /> : <FingerprintIcon />}
        Sign in with a passkey
      </Button>
      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
