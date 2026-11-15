"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { FingerprintIcon, Loader2Icon, MailIcon } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { notify, UNEXPECTED_ERROR } from "@/lib/notify";
import { isCancelled, useWebAuthnSupport } from "@/lib/webauthn-client";
import { requestStepUpAction, verifyStepUpCodeAction } from "./actions";
import { finishPasskeyStepUpAction, startPasskeyStepUpAction } from "./passkey-actions";

type Sent = { email: string; resendAt: number };

/**
 * "Confirm it's you" (step-up, src/server/auth/step-up.ts): shown when a
 * sensitive change (recovery codes, passkeys) needs a recent verification.
 * The editor confirms with a 6-digit code emailed to them or, if they have
 * one, with a passkey. On success the session is fresh for ten minutes and
 * `onConfirmed` runs; the server checks again whatever comes next.
 */
export function StepUpCard({
  email,
  hasPasskeys,
  what,
  onConfirmed,
  onCancel,
}: {
  email: string;
  hasPasskeys: boolean;
  /** What needs it, e.g. "Making recovery codes". */
  what: string;
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  const webauthn = useWebAuthnSupport();
  const [sent, setSent] = useState<Sent | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const secondsLeft = useCountdown(sent?.resendAt ?? 0);
  const canUsePasskey = hasPasskeys && webauthn;

  const run = (task: () => Promise<void>) =>
    startTransition(async () => {
      try {
        await task();
      } catch {
        notify.error(UNEXPECTED_ERROR.title, UNEXPECTED_ERROR.description);
      }
    });

  const fail = (title: string, message: string) => {
    setError(message);
    setCode("");
    notify.error(title, message);
  };

  const sendCode = () =>
    run(async () => {
      const res = await requestStepUpAction();
      if (res.ok) {
        setSent({ email: res.email, resendAt: res.resendAt });
        setError(null);
        setCode("");
        notify.success("Check your email", `We sent a 6-digit code to ${res.email}.`);
      } else fail("Couldn't send a code", res.error);
    });

  const confirmCode = (value: string) =>
    run(async () => {
      const res = await verifyStepUpCodeAction(value);
      if (res.ok) onConfirmed();
      else fail("Couldn't confirm it's you", res.error);
    });

  const confirmWithPasskey = () =>
    run(async () => {
      const start = await startPasskeyStepUpAction();
      if (!start.ok) return fail("Couldn't confirm it's you", start.error);
      let response;
      try {
        response = await startAuthentication({ optionsJSON: start.options });
      } catch (err) {
        // Closing the prompt isn't an error: the card just stays as it was.
        if (isCancelled(err)) return;
        return fail("Couldn't confirm it's you", "That passkey didn't confirm it's you. Try again, or use an email code.");
      }
      const res = await finishPasskeyStepUpAction(response);
      if (res.ok) onConfirmed();
      else fail("Couldn't confirm it's you", res.error);
    });

  const passkeyButton = canUsePasskey && (
    <Button type="button" variant={sent ? "outline" : "default"} disabled={pending} onClick={confirmWithPasskey}>
      <FingerprintIcon />
      Use a passkey
    </Button>
  );

  return (
    <div className="grid gap-4 rounded-xl border bg-card p-6">
      <div className="grid gap-1">
        <h3 ref={focusOnMount} tabIndex={-1} className="font-medium outline-none">
          Confirm it&apos;s you
        </h3>
        <p className="text-sm text-muted-foreground">
          {sent ? (
            <>
              We sent a 6-digit code to <span className="font-medium text-foreground">{sent.email}</span>. It expires in
              10 minutes.
            </>
          ) : (
            <>
              {what} needs a recent sign-in.{" "}
              {canUsePasskey ? "Use one of your passkeys, or we'll" : "We'll"} email a 6-digit code to{" "}
              <span className="font-medium text-foreground">{email}</span>
              {canUsePasskey ? "." : " to confirm it's you."}
            </>
          )}
        </p>
      </div>

      {sent ? (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6) confirmCode(code);
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="step-up-code">Confirmation code</Label>
            <InputOTP
              id="step-up-code"
              maxLength={6}
              pattern={REGEXP_ONLY_DIGITS}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={setCode}
              onComplete={(v: string) => confirmCode(v)}
              disabled={pending}
              aria-invalid={error ? true : undefined}
              autoFocus
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || code.length !== 6}>
              {pending && <Loader2Icon className="animate-spin" />}
              Confirm
            </Button>
            <Button type="button" variant="ghost" disabled={pending || secondsLeft > 0} onClick={sendCode}>
              {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : "Resend code"}
            </Button>
            {passkeyButton}
            <Button type="button" variant="link" className="px-0" disabled={pending} onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {passkeyButton}
            <Button type="button" variant={canUsePasskey ? "outline" : "default"} disabled={pending} onClick={sendCode}>
              {pending ? <Loader2Icon className="animate-spin" /> : <MailIcon />}
              Email me a code
            </Button>
            <Button type="button" variant="link" className="px-0" disabled={pending} onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Move focus to a heading when its card appears (a ref callback runs once, on mount). */
export function focusOnMount(el: HTMLElement | null) {
  el?.focus();
}

function useCountdown(until: number): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (until === 0) return;
    const tick = () => {
      const next = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLeft(next);
      return next;
    };
    // First tick right away (from a timer, so no state is set synchronously in the effect).
    const first = setTimeout(tick, 0);
    const id = setInterval(() => {
      if (tick() === 0) clearInterval(id);
    }, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [until]);
  return left;
}
