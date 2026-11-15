"use client";

import { Loader2Icon, PlusIcon } from "lucide-react";
import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { COLLECTION_INTRO_MAX, COLLECTION_TITLE_MAX } from "@/lib/collection-limits";
import { notify, withErrorToast } from "@/lib/notify";
import { createCollectionAction, updateCollectionAction, type CollectionFormState } from "./actions";

/*
 * Controlled fields (CLAUDE.md): React resets uncontrolled inputs after a form
 * action, which would wipe what was typed on a validation error.
 */

function Fields({
  idPrefix,
  title,
  setTitle,
  intro,
  setIntro,
  errors,
}: {
  idPrefix: string;
  title: string;
  setTitle: (v: string) => void;
  intro: string;
  setIntro: (v: string) => void;
  errors: CollectionFormState["errors"];
}) {
  return (
    <>
      {errors?.form && (
        <Alert variant="destructive">
          <AlertDescription>{errors.form}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-title`}>Title</Label>
        <Input
          id={`${idPrefix}-title`}
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={COLLECTION_TITLE_MAX}
          required
          aria-invalid={errors?.title ? true : undefined}
          aria-describedby={errors?.title ? `${idPrefix}-title-error` : undefined}
          className="font-serif text-lg"
        />
        {errors?.title && (
          <p id={`${idPrefix}-title-error`} role="alert" className="text-sm text-destructive">
            {errors.title}
          </p>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-intro`}>
          Intro <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id={`${idPrefix}-intro`}
          name="intro"
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          maxLength={COLLECTION_INTRO_MAX}
          rows={3}
          aria-invalid={errors?.intro ? true : undefined}
          aria-describedby={`${idPrefix}-intro-help${errors?.intro ? ` ${idPrefix}-intro-error` : ""}`}
        />
        <p id={`${idPrefix}-intro-help`} className="text-xs text-muted-foreground tabular-nums">
          A sentence or two about the sequence. {intro.length} / {COLLECTION_INTRO_MAX}
        </p>
        {errors?.intro && (
          <p id={`${idPrefix}-intro-error`} role="alert" className="text-sm text-destructive">
            {errors.intro}
          </p>
        )}
      </div>
    </>
  );
}

/** "New collection" on the list page: creating redirects to the new collection's page. */
export function NewCollectionForm() {
  const [title, setTitle] = useState("");
  const [intro, setIntro] = useState("");
  const [state, formAction, pending] = useActionState(withErrorToast(createCollectionAction), {});
  return (
    <section aria-labelledby="new-collection" className="grid gap-4 rounded-xl border bg-card p-5">
      <h2 id="new-collection" className="font-serif text-xl">
        New collection
      </h2>
      <form action={formAction} className="grid gap-4" noValidate>
        <Fields idPrefix="new-collection" title={title} setTitle={setTitle} intro={intro} setIntro={setIntro} errors={state.errors} />
        <Button type="submit" disabled={pending} className="justify-self-start">
          {pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
          Create collection
        </Button>
      </form>
    </section>
  );
}

/** Title and intro of an existing collection. The page refreshes on save (the action calls refresh()). */
export function CollectionDetailsForm({
  collectionId,
  title: savedTitle,
  intro: savedIntro,
  slug,
}: {
  collectionId: string;
  title: string;
  intro: string;
  slug: string;
}) {
  const [title, setTitle] = useState(savedTitle);
  const [intro, setIntro] = useState(savedIntro);
  const [state, formAction, pending] = useActionState(
    withErrorToast(async (prev: CollectionFormState, formData: FormData) => {
      const next = await updateCollectionAction(collectionId, prev, formData);
      // From the action's result, not an effect, so it fires once per save.
      if (next.savedAt) notify.success("Collection saved", "Readers see the new title right away.");
      return next;
    }),
    {},
  );
  return (
    <section aria-labelledby="collection-details" className="grid gap-4 rounded-xl border bg-card p-5">
      <h2 id="collection-details" className="font-serif text-xl">
        Details
      </h2>
      <form action={formAction} className="grid gap-4" noValidate>
        <Fields idPrefix="collection" title={title} setTitle={setTitle} intro={intro} setIntro={setIntro} errors={state.errors} />
        <p className="text-xs text-muted-foreground">
          Its link name, <span className="font-mono">{slug}</span>, stays the same when you rename it.
        </p>
        <Button type="submit" disabled={pending} className="justify-self-start">
          {pending && <Loader2Icon className="animate-spin" />}
          Save details
        </Button>
      </form>
    </section>
  );
}
