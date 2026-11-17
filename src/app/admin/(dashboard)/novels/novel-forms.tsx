"use client";

import { Loader2Icon, PlusIcon } from "lucide-react";
import { useActionState, useState } from "react";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { BLURB_MAX, NOVEL_TITLE_MAX } from "@/lib/novel-limits";
import { notify, withErrorToast } from "@/lib/notify";
import { POEM_LANGUAGES } from "@/lib/poem-languages";
import { createNovelAction, updateNovelAction, type NovelFormState } from "./actions";

/*
 * A novel's details (docs/PLAN.md, Phase 23a): title, blurb, language and
 * ongoing/complete. Controlled fields (CLAUDE.md): React resets uncontrolled
 * inputs after a form action, which would wipe a blurb on a validation error.
 */

export type NovelDetails = { title: string; blurb: string; language: string; status: "ongoing" | "complete" };

/** On phones every control is at least 44 px tall. */
export const TOUCH = "max-sm:h-11";
/** NativeSelect puts its className on a wrapper: reach the <select> inside it. */
const SELECT = "w-full max-sm:[&_select]:h-11";

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
          What the back cover would say. {values.blurb.length.toLocaleString("en")} / {BLURB_MAX.toLocaleString("en")}
        </p>
        <FieldError id={`${prefix}-blurb-error`} message={err("blurb")} />
        <SpecialLetters fields={[`${prefix}-blurb`, `${prefix}-title`]} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${prefix}-language`}>Language</Label>
          <NativeSelect
            id={`${prefix}-language`}
            name="language"
            value={values.language}
            onChange={(e) => set("language", e.target.value)}
            aria-invalid={err("language") ? true : undefined}
            className={SELECT}
          >
            <NativeSelectOption value="">Not set</NativeSelectOption>
            {POEM_LANGUAGES.map((l) => (
              <NativeSelectOption key={l.code} value={l.code}>
                {l.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldError id={`${prefix}-language-error`} message={err("language")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${prefix}-status`}>Status</Label>
          <NativeSelect
            id={`${prefix}-status`}
            name="status"
            value={values.status}
            onChange={(e) => set("status", e.target.value as NovelDetails["status"])}
            aria-describedby={`${prefix}-status-help`}
            className={SELECT}
          >
            <NativeSelectOption value="ongoing">Ongoing</NativeSelectOption>
            <NativeSelectOption value="complete">Complete</NativeSelectOption>
          </NativeSelect>
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

/** The novel page's details form, inline. */
export function NovelDetailsForm({ novelId, initial, slug }: { novelId: string; initial: NovelDetails; slug: string }) {
  const [values, set] = useDetails(initial);
  const [saved, setSaved] = useState(initial);
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
    if (state.savedAt) setSaved(values);
  }
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  return (
    <section aria-labelledby="details-heading" className="grid gap-4 rounded-xl border bg-card p-5">
      <h2 id="details-heading" className="font-serif text-xl">
        Details
      </h2>
      <form action={formAction} className="grid gap-4" noValidate>
        <Fields prefix="novel" values={values} set={set} errors={state.errors} />
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
