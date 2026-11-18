"use client";

import { EyeIcon, EyeOffIcon, KeyRoundIcon, Loader2Icon, LockIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { FormSelect, FormSwitch } from "@/components/form-controls";
import { SpecialLetters } from "@/components/special-letters";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BLURB_MAX, NOVEL_TITLE_MAX } from "@/lib/novel-limits";
import { notify, withErrorToast } from "@/lib/notify";
import { PASSWORD_MIN } from "@/lib/poem-limits";
import { POEM_LANGUAGES } from "@/lib/poem-languages";
import { createNovelAction, updateNovelAction, type NovelFormState } from "./actions";

/*
 * A novel's details (docs/PLAN.md, Phase 23a): title, blurb, language and
 * ongoing/complete; on the novel's page also who can read it (Phase 25): one
 * password for the whole book, like the poem form's (the novel's own in
 * per_poem mode, the shared one from Settings otherwise). The password is
 * never sent back: the page knows only `hasPassword`. Controlled fields
 * (CLAUDE.md): React resets uncontrolled inputs after a form action, which
 * would wipe a blurb on a validation error.
 */

export type NovelDetails = { title: string; blurb: string; language: string; status: "ongoing" | "complete" };

/** On phones every control is at least 44 px tall. */
export const TOUCH = "max-sm:h-11";
const SELECT = "w-full";
const LANGUAGE_OPTIONS = [{ value: "", label: "Not set" }, ...POEM_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))];
const STATUS_OPTIONS = [
  { value: "ongoing", label: "Ongoing" },
  { value: "complete", label: "Complete" },
];

function Fields({
  prefix,
  values,
  set,
  errors,
}: {
  prefix: string;
  values: NovelDetails;
  set: <K extends keyof NovelDetails>(key: K, value: NovelDetails[K]) => void;
  errors: NovelFormState["errors"];
}) {
  const err = (k: keyof NonNullable<NovelFormState["errors"]>) => errors?.[k];
  return (
    <>
      {err("form") && (
        <Alert variant="destructive">
          <AlertDescription>{err("form")}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`${prefix}-title`}>Title</Label>
        <Input
          id={`${prefix}-title`}
          name="title"
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          maxLength={NOVEL_TITLE_MAX}
          required
          aria-invalid={err("title") ? true : undefined}
          aria-describedby={err("title") ? `${prefix}-title-error` : undefined}
          className={`font-serif text-lg ${TOUCH}`}
        />
        <FieldError id={`${prefix}-title-error`} message={err("title")} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${prefix}-blurb`}>
          Blurb <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id={`${prefix}-blurb`}
          name="blurb"
          value={values.blurb}
          onChange={(e) => set("blurb", e.target.value)}
          maxLength={BLURB_MAX}
          rows={4}
          aria-invalid={err("blurb") ? true : undefined}
          aria-describedby={`${prefix}-blurb-help${err("blurb") ? ` ${prefix}-blurb-error` : ""}`}
          className="font-serif text-base leading-relaxed"
        />
        <p id={`${prefix}-blurb-help`} className="text-xs text-muted-foreground tabular-nums">
          A short description of your novel, like the words on a book’s back cover. Readers see it on the
          novel’s page and its book card. {values.blurb.length.toLocaleString("en")} / {BLURB_MAX.toLocaleString("en")}
        </p>
        <FieldError id={`${prefix}-blurb-error`} message={err("blurb")} />
        <SpecialLetters fields={[`${prefix}-blurb`, `${prefix}-title`]} />
      </div>
      {/* items-start: each column is as tall as its own content. Stretched to the row's height, a
          column with fewer rows (no help text) spread the extra space between its label and box,
          so they sat lower than the other column's. */}
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${prefix}-language`}>Language</Label>
          <FormSelect
            id={`${prefix}-language`}
            value={values.language}
            onValueChange={(v) => set("language", v)}
            options={LANGUAGE_OPTIONS}
            aria-invalid={err("language") ? true : undefined}
            aria-describedby={err("language") ? `${prefix}-language-error` : undefined}
            className={SELECT}
          />
          <input type="hidden" name="language" value={values.language} />
          <FieldError id={`${prefix}-language-error`} message={err("language")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${prefix}-status`}>Status</Label>
          <FormSelect
            id={`${prefix}-status`}
            value={values.status}
            onValueChange={(v) => set("status", v as NovelDetails["status"])}
            options={STATUS_OPTIONS}
            aria-describedby={`${prefix}-status-help`}
            className={SELECT}
          />
          <input type="hidden" name="status" value={values.status} />
          <p id={`${prefix}-status-help`} className="text-xs text-muted-foreground">
            Tells readers whether more chapters are coming.
          </p>
        </div>
      </div>
    </>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

function useDetails(initial: NovelDetails) {
  const [values, setValues] = useState(initial);
  const set = <K extends keyof NovelDetails>(key: K, value: NovelDetails[K]) => setValues((v) => ({ ...v, [key]: value }));
  return [values, set] as const;
}

/** "New novel", in a Dialog mounted only while open; creating opens the novel's page. */
export function NewNovelDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className={TOUCH}>
          <PlusIcon />
          New novel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <NewNovelForm />
      </DialogContent>
    </Dialog>
  );
}

function NewNovelForm() {
  const [values, set] = useDetails({ title: "", blurb: "", language: "", status: "ongoing" });
  const [state, formAction, pending] = useActionState(
    withErrorToast(async (prev: NovelFormState, formData: FormData) => {
      const next = await createNovelAction(prev, formData); // redirects on success
      if (next.errors) notify.error("Couldn't create the novel", next.errors.form ?? Object.values(next.errors)[0]);
      return next;
    }),
    {},
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>New novel</DialogTitle>
        <DialogDescription>
          A novel, or a short story with one chapter. You&apos;ll add chapters next; readers see only the ones you publish.
        </DialogDescription>
      </DialogHeader>
      <form action={formAction} className="grid gap-4" noValidate>
        <Fields prefix="new-novel" values={values} set={set} errors={state.errors} />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" className={TOUCH}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" disabled={pending} className={TOUCH}>
            {pending && <Loader2Icon className="animate-spin" />}
            Create novel
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export type NovelAccess = { isPrivate: boolean; hasPassword: boolean; passwordMode: "per_poem" | "shared" };

const PRIVATE_NEEDS_PASSWORD = "Private novels need a password readers can use";

/** The novel page's details form, inline. */
export function NovelDetailsForm({
  novelId,
  initial,
  slug,
  access,
  cover,
}: {
  novelId: string;
  initial: NovelDetails;
  slug: string;
  access: NovelAccess;
  /** The cover's upload panel (Phase 25), outside the form: it saves on its own. */
  cover?: React.ReactNode;
}) {
  const [values, set] = useDetails(initial);
  const [saved, setSaved] = useState(initial);
  const shared = access.passwordMode === "shared";
  const [isPrivate, setIsPrivate] = useState(access.isPrivate);
  const [savedPrivate, setSavedPrivate] = useState(access.isPrivate);
  const [hasPassword, setHasPassword] = useState(access.hasPassword);
  const [password, setPassword] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(
    withErrorToast(async (prev: NovelFormState, formData: FormData) => {
      const next = await updateNovelAction(novelId, prev, formData);
      if (next.savedAt) notify.success("Details saved");
      else if (next.errors) notify.error("Couldn't save the details", next.errors.form ?? Object.values(next.errors)[0]);
      return next;
    }),
    {},
  );
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    if (state.savedAt) {
      setSaved(values);
      setSavedPrivate(isPrivate);
      // Saved private in per_poem mode means it has a password now; public drops it.
      setHasPassword(isPrivate && !shared && (hasPassword || password !== ""));
      setPassword("");
    }
  }
  const dirty = JSON.stringify(values) !== JSON.stringify(saved) || isPrivate !== savedPrivate || password !== "";
  const errors = clientError ? { ...state.errors, password: clientError } : state.errors;
  return (
    <section aria-labelledby="details-heading" className="grid gap-4 rounded-xl border bg-card p-5">
      <h2 id="details-heading" className="font-serif text-xl">
        Details
      </h2>
      {cover}
      <form
        action={formAction}
        onSubmit={(e) => {
          // Instant feedback; the server checks everything again.
          const problem =
            isPrivate && !shared && !hasPassword && !password
              ? PRIVATE_NEEDS_PASSWORD
              : isPrivate && !shared && password && password.length < PASSWORD_MIN
                ? `Use at least ${PASSWORD_MIN} characters`
                : null;
          setClientError(problem);
          if (problem) {
            e.preventDefault();
            notify.error("Couldn't save the details", problem);
            document.getElementById("novel-password")?.focus();
          }
        }}
        className="grid gap-4"
        noValidate
      >
        <Fields prefix="novel" values={values} set={set} errors={errors} />
        <AccessFields
          isPrivate={isPrivate}
          setIsPrivate={setIsPrivate}
          savedPrivate={savedPrivate}
          shared={shared}
          hasPassword={hasPassword}
          password={password}
          setPassword={(p) => {
            setPassword(p);
            setClientError(null);
          }}
          error={errors?.password}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Link name: <span className="font-mono">{slug}</span>. It follows the title until a chapter is published.
          </p>
          <Button type="submit" disabled={pending || !dirty} className={TOUCH}>
            {pending && <Loader2Icon className="animate-spin" />}
            Save details
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Who can read the novel: public, or private behind one password for every chapter (Phase 25). */
function AccessFields({
  isPrivate,
  setIsPrivate,
  savedPrivate,
  shared,
  hasPassword,
  password,
  setPassword,
  error,
}: {
  isPrivate: boolean;
  setIsPrivate: (v: boolean) => void;
  savedPrivate: boolean;
  shared: boolean;
  hasPassword: boolean;
  password: string;
  setPassword: (v: string) => void;
  error?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="grid gap-3 rounded-lg border p-4">
      <input type="hidden" name="visibility" value={isPrivate ? "private" : "public"} />
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <Label htmlFor="novel-private" className="flex items-center gap-1.5">
            <LockIcon className="size-3.5" aria-hidden />
            Password protected
          </Label>
          <p id="novel-private-help" className="text-sm text-muted-foreground">
            {!isPrivate
              ? "Anyone can read this novel."
              : "Readers see the cover, title, blurb and chapter list. One password opens every chapter."}
          </p>
        </div>
        {/* FormSwitch: keeps its state across the form's reset after a save; the hidden input posts it. */}
        <FormSwitch
          id="novel-private"
          checked={isPrivate}
          onCheckedChange={setIsPrivate}
          aria-describedby="novel-private-help"
          className="max-sm:mt-1"
        />
      </div>
      {isPrivate && shared && (
        <p className="flex items-start gap-1.5 rounded-lg bg-secondary/60 p-3 text-xs text-secondary-foreground">
          <KeyRoundIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Uses your shared password for all private poems and novels.{" "}
            <Link href="/admin/settings" className="underline underline-offset-2">
              Change in Settings
            </Link>
          </span>
        </p>
      )}
      {isPrivate && !shared && (
        <div className="grid gap-1.5">
          <Label htmlFor="novel-password">{hasPassword ? "New password" : "Password"}</Label>
          <div className="relative">
            <Input
              id="novel-password"
              name="password"
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={hasPassword ? "Leave blank to keep current" : `At least ${PASSWORD_MIN} characters`}
              aria-required={!hasPassword}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "novel-password-error novel-password-help" : "novel-password-help"}
              className={`pr-11 ${TOUCH}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-1/2 right-1 -translate-y-1/2 max-sm:size-9"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Hide password" : "Show password"}
              aria-pressed={show}
            >
              {show ? <EyeOffIcon /> : <EyeIcon />}
            </Button>
          </div>
          <FieldError id="novel-password-error" message={error} />
          <p id="novel-password-help" className="text-xs text-muted-foreground">
            {hasPassword
              ? "Changing it locks out readers who used the old one."
              : "Share it with the readers you want to let in. It opens every chapter."}
          </p>
        </div>
      )}
      {!isPrivate && savedPrivate && (
        <p className="text-xs text-muted-foreground">
          Saving makes every published chapter readable by anyone{shared ? "" : " and removes the password"}.
        </p>
      )}
    </div>
  );
}
