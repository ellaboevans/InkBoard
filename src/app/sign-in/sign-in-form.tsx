"use client";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Loader2Icon, MailIcon } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { notify, withErrorToast } from "@/lib/notify";
import { signInAction, type SignInState } from "./actions";

const initialState: SignInState = { step: "email" };

export function SignInForm() {
  const [state, formAction, pending] = useActionState(
    withErrorToast(async (prev: SignInState, formData: FormData) => {
      const next = await signInAction(prev, formData);
      if (next.error) {
        notify.error(
          next.step === "code" ? "Couldn't sign you in" : "Couldn't send a code",
          next.error,
        );
      } else if (next.step === "code" && (prev.step === "email" || next.notice)) {
        notify.success(
          prev.step === "email" ? "Check your email" : "New code sent",
          `We sent a 6-digit code to ${next.email}.`,
        );
      }
      return next;
    }),
    initialState,
  );

  return state.step === "email" ? (
    <EmailStep state={state} action={formAction} pending={pending} />
  ) : (
    // Remount (clearing the typed code) whenever a new code is issued.
    <CodeStep
      key={state.resendAt}
      state={state}
      action={formAction}
      pending={pending}
    />
  );
}

type StepProps<S> = {
  state: S;
  action: (formData: FormData) => void;
  pending: boolean;
};

function EmailStep({
  state,
  action,
  pending,
}: StepProps<Extract<SignInState, { step: "email" }>>) {
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="intent" value="request" />
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          defaultValue={state.email}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "email-error" : undefined}
          required
          autoFocus
        />
      </div>
      {state.error && (
        <p id="email-error" role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Loader2Icon className="animate-spin" /> : <MailIcon />}
        Email me a sign-in code
      </Button>
    </form>
  );
}

function CodeStep({
  state,
  action,
  pending,
}: StepProps<Extract<SignInState, { step: "code" }>>) {
  const formRef = useRef<HTMLFormElement>(null);
  const [code, setCode] = useState("");
  const secondsLeft = useCountdown(state.resendAt);

  // After a failed attempt, clear the slots so the next code can be typed.
  // (Adjusting state during render when a prop changes, instead of an effect.)
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    if (state.error) setCode("");
  }

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">
        We sent a 6-digit code to{" "}
        <span className="font-medium text-foreground">{state.email}</span>. It
        expires in 10 minutes.
      </p>

      <form ref={formRef} action={action} className="grid gap-4">
        <input type="hidden" name="intent" value="verify" />
        <div className="grid justify-center gap-2">
          <Label htmlFor="code" className="sr-only">
            Sign-in code
          </Label>
          <InputOTP
            id="code"
            name="code"
            maxLength={6}
            pattern={REGEXP_ONLY_DIGITS}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={setCode}
            onComplete={() => formRef.current?.requestSubmit()}
            disabled={pending}
            aria-invalid={state.error ? true : undefined}
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

        {state.error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        {state.notice && !state.error && (
          <p role="status" className="text-center text-sm text-muted-foreground">
            {state.notice}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          disabled={pending || code.length !== 6}
        >
          {pending && <Loader2Icon className="animate-spin" />}
          Sign in
        </Button>
      </form>

      <form action={action} className="flex items-center justify-between gap-2 text-sm">
        <input type="hidden" name="email" value={state.email} />
        <Button
          type="submit"
          name="intent"
          value="change-email"
          variant="link"
          className="px-0"
          disabled={pending}
        >
          Use a different email
        </Button>
        <Button
          type="submit"
          name="intent"
          value="resend"
          variant="ghost"
          size="sm"
          disabled={pending || secondsLeft > 0}
        >
          {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : "Resend code"}
        </Button>
      </form>
    </div>
  );
}

function useCountdown(until: number): number {
  const calc = () => Math.max(0, Math.ceil((until - Date.now()) / 1000));
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => {
      const next = calc();
      setLeft(next);
      if (next === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until]);
  return left;
}
