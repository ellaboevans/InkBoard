"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify, withErrorToast } from "@/lib/notify";
import { PEN_NAME_MAX, PEN_NAME_MIN } from "@/lib/profile-limits";
import { completeOnboardingAction, type OnboardingState } from "../actions";

export function OnboardingForm() {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(
    withErrorToast(async (prev: OnboardingState, formData: FormData) => {
      const next = await completeOnboardingAction(prev, formData);
      if (next.error) notify.error("Couldn't save your pen name", next.error);
      return next;
    }),
    {},
  );
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="penName">Pen name</Label>
        <Input
          id="penName"
          name="penName"
          placeholder="e.g. Emily Dickinson"
          defaultValue={state.penName}
          minLength={PEN_NAME_MIN}
          maxLength={PEN_NAME_MAX}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "penName-error" : undefined}
          required
          autoFocus
        />
      </div>
      {state.error && (
        <p id="penName-error" role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending && <Loader2Icon className="animate-spin" />}
        Continue to dashboard
      </Button>
    </form>
  );
}
