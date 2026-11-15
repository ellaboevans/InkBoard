"use client";

import { Loader2Icon, PencilIcon, PlusIcon } from "lucide-react";
import { useActionState, useState } from "react";
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

type DialogFormProps = {
  title: string;
  description: string;
  submitLabel: string;
  initial: { title: string; intro: string };
  /** Resolves with errors, or redirects / closes on success. */
  action: (prev: CollectionFormState, formData: FormData) => Promise<CollectionFormState>;
  onSaved?: () => void;
  footnote?: React.ReactNode;
};

/**
 * The form inside a dialog. Mounted only while the dialog is open, so each
 * opening starts from the saved values; while open, a validation error keeps
 * what was typed (controlled fields). Toasts fire from the action wrapper.
 */
function DialogForm({ title: heading, description, submitLabel, initial, action, onSaved, footnote }: DialogFormProps) {
  const [title, setTitle] = useState(initial.title);
  const [intro, setIntro] = useState(initial.intro);
  const [state, formAction, pending] = useActionState(
    withErrorToast(async (prev: CollectionFormState, formData: FormData) => {
      const next = await action(prev, formData);
      if (next.savedAt) onSaved?.();
      else if (next.errors) notify.error(`Couldn't ${submitLabel.toLowerCase()}`, next.errors.form ?? Object.values(next.errors)[0]);
      return next;
    }),
    {},
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>{heading}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <form action={formAction} className="grid gap-4" noValidate>
        <Fields idPrefix="collection" title={title} setTitle={setTitle} intro={intro} setIntro={setIntro} errors={state.errors} />
        {footnote}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/** "New collection": creating redirects to the new collection's page. */
export function NewCollectionDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon />
          New collection
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogForm
          title="New collection"
          description="Group poems into a sequence, like a cycle or a chapbook. You'll add and order poems next."
          submitLabel="Create collection"
          initial={{ title: "", intro: "" }}
          action={createCollectionAction}
        />
      </DialogContent>
    </Dialog>
  );
}

/** "Edit details": title and intro. Closes on save; the page refreshes (the action calls refresh()). */
export function EditCollectionDialog({
  collectionId,
  title,
  intro,
  slug,
}: {
  collectionId: string;
  title: string;
  intro: string;
  slug: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PencilIcon />
          Edit details
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogForm
          title="Edit collection"
          description="Its title and intro. Readers see the new title right away."
          submitLabel="Save details"
          initial={{ title, intro }}
          action={updateCollectionAction.bind(null, collectionId)}
          onSaved={() => {
            setOpen(false); // Radix returns focus to "Edit details"
            notify.success("Collection saved", "Readers see the new title right away.");
          }}
          footnote={
            <p className="text-xs text-muted-foreground">
              Its link name, <span className="font-mono">{slug}</span>, stays the same when you rename it.
            </p>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
