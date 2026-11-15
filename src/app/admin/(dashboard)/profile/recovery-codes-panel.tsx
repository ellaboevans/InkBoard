"use client";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import {
  CopyIcon,
  DownloadIcon,
  KeyRoundIcon,
  Loader2Icon,
  MailIcon,
  PrinterIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { notify, UNEXPECTED_ERROR } from "@/lib/notify";
import { pluralCount } from "@/lib/plural";
import { RECOVERY_CODES_LOW, formatRecoveryCode, recoveryCodesText } from "@/lib/recovery-code-format";
import {
  confirmStepUpAction,
  createRecoveryCodesAction,
  requestStepUpAction,
  type RecoveryCodesResult,
} from "./actions";

type Props = {
  email: string;
  /** Codes in the current set; 0 = never set up. */
  total: number;
  unused: number;
  /** When the current set was made, preformatted on the server. */
  createdLabel: string | null;
  /** The session proved inbox access recently (a hint only: the server re-checks). */
  fresh: boolean;
};

type StepUp = { sent: false } | { sent: true; email: string; resendAt: number };

/**
 * The profile's "Recovery codes" section (docs/PLAN.md, Phase 16): status,
 * the step-up confirmation when the sign-in isn't recent, and the new codes,
 * shown once with Copy, Download and Print. The codes live only in this
 * component's state; "I've saved them" (or a full reload) clears them.
 */
export function RecoveryCodesPanel({ email, total, unused, createdLabel, fresh }: Props) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [stepUp, setStepUp] = useState<StepUp | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handle = (res: RecoveryCodesResult) => {
    if (res.ok) {
      setCodes(res.codes);
      setStepUp(null);
      setError(null);
      notify.success(total === 0 ? "Recovery codes ready" : "New recovery codes ready", "Save them now: they won't be shown again.");
    } else if ("stepUp" in res) {
      setStepUp({ sent: false });
      setError(null);
    } else {
      setError(res.error);
      notify.error("Couldn't confirm it's you", res.error);
    }
  };

  const run = (task: () => Promise<void>) =>
    startTransition(async () => {
      try {
        await task();
      } catch {
        notify.error(UNEXPECTED_ERROR.title, UNEXPECTED_ERROR.description);
      }
    });

  const create = () => {
    setConfirmReplace(false);
    // Not recently signed in: go straight to the confirmation (the server would ask anyway).
    if (!fresh) {
      setStepUp({ sent: false });
      return;
    }
    run(async () => handle(await createRecoveryCodesAction()));
  };

  const sendCode = () =>
    run(async () => {
      const res = await requestStepUpAction();
      if (res.ok) {
        setStepUp({ sent: true, email: res.email, resendAt: res.resendAt });
        setError(null);
        notify.success("Check your email", `We sent a 6-digit code to ${res.email}.`);
      } else {
        setError(res.error);
        notify.error("Couldn't send a code", res.error);
      }
    });

  const confirm = (code: string) => run(async () => handle(await confirmStepUpAction(code)));

  if (codes) {
    return <NewCodes codes={codes} email={email} onDone={() => setCodes(null)} />;
  }

  if (stepUp) {
    return (
      <StepUpCard
        key={stepUp.sent ? stepUp.resendAt : 0}
        email={email}
        stepUp={stepUp}
        pending={pending}
        error={error}
        onSend={sendCode}
        onConfirm={confirm}
        onCancel={() => {
          setStepUp(null);
          setError(null);
        }}
      />
    );
  }

  const low = total > 0 && unused <= RECOVERY_CODES_LOW;
  return (
    <div className="grid gap-4 rounded-xl border bg-card p-6">
      <div className="flex items-start gap-3">
        <KeyRoundIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="grid gap-1">
          <p className="font-medium" data-testid="recovery-status">
            {total === 0
              ? "Not set up yet"
              : `${unused} of ${pluralCount(total, "code")} left`}
          </p>
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? "Make a set of ten codes now, while you can get to your email. Each one signs you in once, from any computer, without email."
              : low
                ? "You're running low. Make a new set so you always have a way in without email."
                : `Made ${createdLabel ?? "earlier"}. Each code signs you in once, without email.`}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant={total === 0 || low ? "default" : "outline"}
          disabled={pending}
          onClick={() => (total > 0 ? setConfirmReplace(true) : create())}
        >
          {pending ? <Loader2Icon className="animate-spin" /> : <ShieldCheckIcon />}
          {total === 0 ? "Create recovery codes" : "Make a new set"}
        </Button>
        {!fresh && (
          <p className="text-sm text-muted-foreground">We&apos;ll email you a code to confirm it&apos;s you first.</p>
        )}
      </div>

      <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make a new set of recovery codes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your current codes, including any you&apos;ve printed or saved, stop working right away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button type="button" onClick={create}>
              Replace my codes
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StepUpCard({
  email,
  stepUp,
  pending,
  error,
  onSend,
  onConfirm,
  onCancel,
}: {
  email: string;
  stepUp: StepUp;
  pending: boolean;
  error: string | null;
  onSend: () => void;
  onConfirm: (code: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const secondsLeft = useCountdown(stepUp.sent ? stepUp.resendAt : 0);
  // Clear the slots after a wrong code (adjusting state during render, not in an effect).
  const [seenError, setSeenError] = useState(error);
  if (seenError !== error) {
    setSeenError(error);
    if (error) setCode("");
  }

  return (
    <div className="grid gap-4 rounded-xl border bg-card p-6">
      <div className="grid gap-1">
        <h3 ref={focusOnMount} tabIndex={-1} className="font-medium outline-none">
          Confirm it&apos;s you
        </h3>
        <p className="text-sm text-muted-foreground">
          {stepUp.sent ? (
            <>
              We sent a 6-digit code to <span className="font-medium text-foreground">{stepUp.email}</span>. It expires in
              10 minutes.
            </>
          ) : (
            <>
              Making recovery codes needs a recent sign-in. We&apos;ll email a 6-digit code to{" "}
              <span className="font-medium text-foreground">{email}</span> to confirm it&apos;s you.
            </>
          )}
        </p>
      </div>

      {stepUp.sent && (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6) onConfirm(code);
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
              onComplete={(v: string) => onConfirm(v)}
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
              Confirm and make codes
            </Button>
            <Button type="button" variant="ghost" disabled={pending || secondsLeft > 0} onClick={onSend}>
              {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : "Resend code"}
            </Button>
            <Button type="button" variant="link" className="px-0" disabled={pending} onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {!stepUp.sent && (
        <>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={pending} onClick={onSend}>
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

const FILE_NAME = "inkboard-recovery-codes.txt";

function NewCodes({ codes, email, onDone }: { codes: string[]; email: string; onDone: () => void }) {
  const text = () => recoveryCodesText(codes, { email, site: window.location.origin });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      notify.success("Codes copied", "Paste them into your password manager.");
    } catch {
      notify.error("Couldn't copy the codes", "Select them and copy, or use Download instead.");
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text()], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = FILE_NAME;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div className="grid gap-5 rounded-xl border border-primary/40 bg-card p-6">
      <div className="grid gap-1">
        <h3 ref={focusOnMount} tabIndex={-1} className="font-medium outline-none">
          Your recovery codes
        </h3>
        <p className="text-sm text-muted-foreground">
          Save them now: this is the only time they&apos;re shown. Each code works once.
        </p>
      </div>
      <ol
        aria-label="Recovery codes"
        className="grid grid-cols-1 gap-x-8 gap-y-2 rounded-lg bg-muted px-5 py-4 min-[420px]:grid-cols-2"
      >
        {codes.map((c, i) => (
          <li key={c} className="flex items-baseline gap-3">
            <span className="w-5 text-right text-xs text-muted-foreground tabular-nums" aria-hidden>
              {i + 1}.
            </span>
            <code className="font-mono text-base tracking-wider slashed-zero">{formatRecoveryCode(c)}</code>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={copy}>
          <CopyIcon />
          Copy
        </Button>
        <Button type="button" variant="outline" onClick={download}>
          <DownloadIcon />
          Download (.txt)
        </Button>
        <Button type="button" variant="outline" onClick={() => window.print()}>
          <PrinterIcon />
          Print
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Keep them somewhere safe and private: a password manager, or printed and folded into your wallet. Anyone with
        your email address and one of these codes can sign in as you.
      </p>
      <div>
        <Button type="button" onClick={onDone}>
          I&apos;ve saved my codes
        </Button>
      </div>
      <PrintSheet codes={codes} email={email} />
    </div>
  );
}

/**
 * What Print prints: just the codes. Portalled to <body> and shown only in
 * print, where globals.css hides everything else (`[data-print-sheet]`).
 */
function PrintSheet({ codes, email }: { codes: string[]; email: string }) {
  // Mounted only after a click (codes exist only then), so document is there.
  return createPortal(
    <div data-print-sheet className="hidden p-10 text-black print:block">
      <p className="font-serif text-2xl">InkBoard recovery codes</p>
      <p className="mt-1 text-sm">{email}</p>
      <ol className="mt-6 grid grid-cols-2 gap-x-10 gap-y-3">
        {codes.map((c) => (
          <li key={c} className="font-mono text-lg tracking-wider slashed-zero">
            {formatRecoveryCode(c)}
          </li>
        ))}
      </ol>
      <p className="mt-6 text-sm">
        Each code signs you in once, without your email, at {typeof window === "undefined" ? "" : window.location.host}
        /sign-in/recovery. Keep this somewhere safe and private.
      </p>
    </div>,
    document.body,
  );
}

/** Move focus to a heading when its card appears (a ref callback runs once, on mount). */
function focusOnMount(el: HTMLElement | null) {
  el?.focus();
}

function useCountdown(until: number): number {
  const calc = () => Math.max(0, Math.ceil((until - Date.now()) / 1000));
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    if (until === 0) return;
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
