"use client";

import { CheckCircle2Icon } from "lucide-react";
import { useActionState, useId, useState } from "react";
import { FormRadioGroup } from "@/components/form-controls";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { withErrorToast } from "@/lib/notify";
import {
  REPORT_DETAILS_MAX,
  REPORT_EMAIL_MAX,
  REPORT_REASONS,
  REPORT_THANKS,
  type ReportTarget,
  validateReport,
} from "@/lib/report";
import { reportAction, type ReportState } from "./report-actions";

/**
 * The report dialog's body (docs/PLAN.md, Phase 32), loaded lazily by
 * ReportLink. Controlled fields (a validation error mustn't wipe them), the
 * reason through FormRadioGroup plus our own hidden input.
 */
export default function ReportForm({ target }: { target: ReportTarget }) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [shown, setShown] = useState<ReportState>({});
  const [state, action, pending] = useActionState(
    withErrorToast(async (prev: ReportState, formData: FormData) => reportAction(target, prev, formData)),
    {},
  );
  // Show the server's answer when it arrives (adjusted during render, not in an effect).
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    setShown(state);
  }

  if (shown.sent) {
    return (
      <div className="grid gap-4" data-report-sent>
        <p role="status" className="flex items-start gap-2 text-base">
          <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          {REPORT_THANKS}
        </p>
        <DialogClose asChild>
          <Button className="min-h-11 justify-self-end">Close</Button>
        </DialogClose>
      </div>
    );
  }

  const errors = shown.errors ?? {};
  const count = [...details].length;
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const check = validateReport({ reason, details, email });
    if (!check.ok) {
      e.preventDefault();
      setShown({ errors: check.errors });
      const first = check.errors.reason ? `${id}-reason-${REPORT_REASONS[0].value}` : check.errors.details ? `${id}-details` : `${id}-email`;
      document.getElementById(first)?.focus();
    }
  };

  return (
    <form action={action} onSubmit={onSubmit} noValidate className="grid gap-5">
      {shown.error && (
        <p role="alert" className="text-sm text-destructive">
          {shown.error}
        </p>
      )}
      <fieldset className="grid gap-2" aria-describedby={errors.reason ? `${id}-reason-error` : undefined}>
        <legend className="mb-2 text-sm font-medium">What’s wrong?</legend>
        <input type="hidden" name="reason" value={reason} />
        <FormRadioGroup
          value={reason}
          onValueChange={(v) => {
            setReason(v);
            setShown((s) => ({ ...s, errors: { ...s.errors, reason: undefined } }));
          }}
          aria-invalid={errors.reason ? true : undefined}
          className="gap-0"
        >
          {REPORT_REASONS.map((r) => (
            <Label
              key={r.value}
              htmlFor={`${id}-reason-${r.value}`}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 font-normal hover:bg-muted"
            >
              <RadioGroupItem id={`${id}-reason-${r.value}`} value={r.value} />
              {r.label}
            </Label>
          ))}
        </FormRadioGroup>
        {errors.reason && (
          <p id={`${id}-reason-error`} className="text-sm text-destructive">
            {errors.reason}
          </p>
        )}
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-details`}>Details{reason === "other" ? "" : " (optional)"}</Label>
        <Textarea
          id={`${id}-details`}
          name="details"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={4}
          required={reason === "other"}
          aria-invalid={errors.details ? true : undefined}
          aria-describedby={`${id}-details-help${errors.details ? ` ${id}-details-error` : ""}`}
          className="min-h-24"
        />
        <p id={`${id}-details-help`} className="text-xs text-muted-foreground">
          {count.toLocaleString("en")} of {REPORT_DETAILS_MAX.toLocaleString("en")} characters.
        </p>
        {errors.details && (
          <p id={`${id}-details-error`} className="text-sm text-destructive">
            {errors.details}
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-email`}>Your email, if you’d like a reply</Label>
        <Input
          id={`${id}-email`}
          name="email"
          type="email"
          autoComplete="email"
          maxLength={REPORT_EMAIL_MAX}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={`${id}-email-help${errors.email ? ` ${id}-email-error` : ""}`}
          className="h-11"
        />
        <p id={`${id}-email-help`} className="text-xs text-muted-foreground">
          Optional. It goes only into the email to InkBoard’s owner, so they can answer; it isn’t stored.
        </p>
        {errors.email && (
          <p id={`${id}-email-error`} className="text-sm text-destructive">
            {errors.email}
          </p>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <DialogClose asChild>
          <Button type="button" variant="ghost" className="min-h-11">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" className="min-h-11" disabled={pending}>
          {pending ? "Sending…" : "Send report"}
        </Button>
      </div>
    </form>
  );
}
