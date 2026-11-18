"use client";

import { EyeIcon, EyeOffIcon, KeyRoundIcon, KeySquareIcon, Loader2Icon } from "lucide-react";
import { useActionState, useState } from "react";
import { notify, withErrorToast } from "@/lib/notify";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PASSWORD_MIN } from "@/lib/poem-limits";
import type { PasswordMode } from "@/server/password-settings";
import { savePasswordSettingsAction, type PasswordSettingsState } from "./actions";
import { pluralCount } from "@/lib/plural";

export function PasswordSettingsForm({
  mode: savedMode,
  privatePoemCount,
  privateNovelCount = 0,
}: {
  mode: PasswordMode;
  privatePoemCount: number;
  /** Private novels follow the same mode (Phase 25). */
  privateNovelCount?: number;
}) {
  const [state, action, pending] = useActionState(
    withErrorToast(async (prev: PasswordSettingsState, formData: FormData) => {
      const next = await savePasswordSettingsAction(prev, formData);
      if (next.savedAt) {
        if (next.mode === "shared") {
          notify.success("Shared password saved", "Readers will need to enter it again.");
        } else {
          notify.success("Each private poem now has its own password.", "Readers will need to unlock again.");
        }
      } else if (next.error) {
        notify.error("Couldn't save your settings", next.error);
      }
      return next;
    }),
    {},
  );
  const [mode, setMode] = useState<PasswordMode>(savedMode);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const switchingToShared = mode === "shared" && savedMode !== "shared";
  const switchingToPerPoem = mode === "per_poem" && savedMode === "shared";
  const changingShared = mode === "shared" && savedMode === "shared";
  const canSave = switchingToPerPoem || switchingToShared || (changingShared && password !== "");
  // "2 private poems", or "2 private poems and 1 private novel" once there are private novels.
  const poems =
    pluralCount(privatePoemCount, "private poem") +
    (privateNovelCount > 0 ? ` and ${pluralCount(privateNovelCount, "private novel")}` : "");
  const error = clientError ?? state.error;

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (mode === "shared" && password.length < PASSWORD_MIN) {
          e.preventDefault();
          setClientError(`Use at least ${PASSWORD_MIN} characters`);
          notify.error("Couldn't save your settings", `Use at least ${PASSWORD_MIN} characters.`);
          document.getElementById("shared-password")?.focus();
        } else {
          setClientError(null);
        }
      }}
      className="grid gap-6 rounded-xl border bg-card p-6"
      noValidate
    >
      <fieldset className="grid gap-3">
        <legend className="mb-3 font-medium">Passwords for private poems and novels</legend>
        <RadioGroup name="mode" value={mode} onValueChange={(v) => setMode(v as PasswordMode)} className="gap-3">
          <ModeOption
            value="per_poem"
            current={savedMode === "per_poem"}
            icon={<KeySquareIcon className="size-4" aria-hidden />}
            title="A different password for each poem and novel"
            description="You set a password on each private poem and each private novel. Unlocking one doesn't unlock the others; a novel's password opens all its chapters."
          />
          <ModeOption
            value="shared"
            current={savedMode === "shared"}
            icon={<KeyRoundIcon className="size-4" aria-hidden />}
            title="One password for all my private poems and novels"
            description="Set it once here. A reader who enters it can read every private poem and novel of yours, including ones you add or make private later, until you change the password."
          />
        </RadioGroup>
      </fieldset>

      {mode === "shared" && (
        <div className="grid gap-1.5">
          <Label htmlFor="shared-password">
            {changingShared ? "New shared password" : "Shared password"}
          </Label>
          <div className="relative">
            <Input
              id="shared-password"
              name="password"
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={changingShared ? "Enter a new password to change it" : `At least ${PASSWORD_MIN} characters`}
              aria-invalid={error ? true : undefined}
              aria-describedby="shared-password-help"
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
          <p id="shared-password-help" className="text-xs text-muted-foreground">
            {changingShared
              ? "Changing it locks out readers who used the old one."
              : `It will apply to your ${poems}. Their individual passwords stop working.`}
          </p>
        </div>
      )}

      {switchingToPerPoem && (
        <Alert>
          <AlertDescription>
            Each of your {poems} will start with your current shared password as its own, so
            none is left unprotected. You can then change them one by one. Readers will need to
            unlock again.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !canSave}>
          {pending && <Loader2Icon className="animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}

function ModeOption({
  value,
  current,
  icon,
  title,
  description,
}: {
  value: PasswordMode;
  current: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  const id = `mode-${value}`;
  return (
    <Label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 font-normal has-data-[state=checked]:border-primary has-data-[state=checked]:bg-accent/40"
    >
      <RadioGroupItem value={value} id={id} className="mt-0.5" aria-describedby={`${id}-desc`} />
      <span className="grid gap-1">
        <span className="flex items-center gap-2 font-medium">
          {icon}
          {title}
          {current && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
              Current
            </span>
          )}
        </span>
        <span id={`${id}-desc`} className="text-sm leading-snug text-muted-foreground">
          {description}
        </span>
      </span>
    </Label>
  );
}
