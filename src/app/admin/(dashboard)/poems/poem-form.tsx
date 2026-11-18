"use client";

import {
  ArrowLeftIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  Loader2Icon,
  LockIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { StatusBadge } from "@/components/poem-badges";
import { FormSelect, FormSwitch } from "@/components/form-controls";
import { SpecialLetters } from "@/components/special-letters";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BODY_MAX, PASSWORD_MIN, TITLE_MAX } from "@/lib/poem-limits";
import { toggleEmphasis } from "@/lib/poem-markdown";
import { POEM_LANGUAGES, type PoemLanguage } from "@/lib/poem-languages";
import type { PoemErrors } from "@/server/poems";
import { useOnceToast } from "@/hooks/use-once-toast";
import { unstable_rethrow } from "next/navigation";
import { notify, withErrorToast } from "@/lib/notify";
import type { PoemFormState } from "./actions";
import { CardPreview } from "./card-preview";
import { HistoryPanel, VersionDialog, type HistoryItem, type SelectedVersion } from "./poem-history";

/** Fields the Special letters bar types into (the last one used). */
const BODY_AND_TITLE = ["body", "title"];

/**
 * ⌘B / ⌘I on a Mac, Ctrl+B / Ctrl+I elsewhere: toggle `**` / `*` around the
 * selection. Ctrl on a Mac is left alone (it moves the caret in text fields).
 */
function onEmphasisShortcut(e: React.KeyboardEvent<HTMLTextAreaElement>, setBody: (v: string) => void) {
  const key = e.key.toLowerCase();
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  if (!(isMac ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey || (key !== "b" && key !== "i")) return;
  e.preventDefault();
  const el = e.currentTarget;
  const edit = toggleEmphasis(el.value, el.selectionStart, el.selectionEnd, key === "b" ? "**" : "*");
  if (el.value.length - (edit.to - edit.from) + edit.insert.length > BODY_MAX) return;
  // insertText goes through the browser's editing path, so ⌘Z undoes it and
  // the input event reaches onChange. Fall back to setting the value.
  el.setSelectionRange(edit.from, edit.to);
  if (!document.execCommand("insertText", false, edit.insert)) {
    setBody(el.value.slice(0, edit.from) + edit.insert + el.value.slice(edit.to));
    requestAnimationFrame(() => el.setSelectionRange(edit.selStart, edit.selEnd));
    return;
  }
  el.setSelectionRange(edit.selStart, edit.selEnd);
}

export type PoemFormPoem = {
  id: string;
  title: string;
  body: string;
  visibility: "public" | "private";
  language: PoemLanguage | null;
  collectionId: string | null;
  status: "draft" | "published";
  hasPassword: boolean;
};

type Props = {
  action: (prev: PoemFormState, formData: FormData) => Promise<PoemFormState>;
  /** Present when editing; absent when creating. */
  poem?: PoemFormPoem;
  deleteAction?: () => Promise<void>;
  justCreated?: boolean;
  /** The author's choice in Settings; "shared" hides the per-poem password. */
  passwordMode: "per_poem" | "shared";
  /** Shown in the card preview's reading view ("by …"). */
  penName: string;
  /** Editing only: saved versions, newest first, and the one opened by ?version=. */
  history?: HistoryItem[];
  selectedVersion?: SelectedVersion | null;
  /** The editor's collections, for the Collection picker. */
  collections: { id: string; title: string }[];
};

export function PoemForm({
  action,
  poem,
  deleteAction,
  justCreated,
  passwordMode,
  penName,
  history,
  selectedVersion = null,
  collections,
}: Props) {
  const shared = passwordMode === "shared";
  // Toast from the action's result rather than an effect, so it fires exactly
  // once per save (effects re-run under StrictMode and when Next re-shows a
  // route kept alive in <Activity>).
  const [state, formAction, pending] = useActionState(
    withErrorToast(async (prev: PoemFormState, formData: FormData) => {
      const next = await action(prev, formData);
      if (next.savedAt) {
        notify.success(
          next.status === "published" ? "Saved and published" : "Draft saved",
          next.status === "published" ? "Readers see the update on the board right away." : "Only you can see drafts.",
        );
      } else if (next.errors) {
        notify.error("Couldn't save the poem", next.errors.form ?? "Fix the highlighted fields and try again.");
      }
      return next;
    }),
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  // Default submit: saves without changing the publish status (⌘S, Enter).
  const keepStatusRef = useRef<HTMLButtonElement>(null);

  // Controlled fields: React resets uncontrolled inputs after a form action,
  // which would wipe a poem on a validation error.
  const [title, setTitle] = useState(poem?.title ?? "");
  const [body, setBody] = useState(poem?.body ?? "");
  const [isPrivate, setIsPrivate] = useState(poem?.visibility === "private");
  // "" = not set (the select's first option).
  const [language, setLanguage] = useState<string>(poem?.language ?? "");
  // "" = none (the select's first option).
  const [collection, setCollection] = useState<string>(poem?.collectionId ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [hasPassword, setHasPassword] = useState(poem?.hasPassword ?? false);
  const [saved, setSaved] = useState({
    title: poem?.title ?? "",
    body: poem?.body ?? "",
    isPrivate: poem?.visibility === "private",
    language: poem?.language ?? "",
    collection: poem?.collectionId ?? "",
  });

  // After a successful save, the current values become the "saved" snapshot.
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    if (state.savedAt) {
      setSaved({ title, body, isPrivate, language, collection });
      setPassword("");
      setHasPassword(state.visibility === "private");
    }
  }

  const status = state.status ?? poem?.status ?? "draft";
  const dirty =
    title !== saved.title ||
    body !== saved.body ||
    isPrivate !== saved.isPrivate ||
    language !== saved.language ||
    collection !== saved.collection ||
    password !== "";
  // Client-side checks give instant feedback; the server re-validates everything.
  const [clientErrors, setClientErrors] = useState<PoemErrors | null>(null);
  const errors = clientErrors ?? state.errors ?? {};

  function validate(e: React.FormEvent<HTMLFormElement>) {
    const found: PoemErrors = {};
    if (!title.trim()) found.title = "Give your poem a title";
    if (!body.trim()) found.body = "The poem is empty";
    if (shared) {
      // The shared password from Settings covers it.
    } else if (isPrivate && !hasPassword && !password) {
      found.password = "Private poems need a password readers can use";
    } else if (isPrivate && password && password.length < PASSWORD_MIN) {
      found.password = `Use at least ${PASSWORD_MIN} characters`;
    }
    if (Object.keys(found).length > 0) {
      e.preventDefault();
      setClientErrors(found);
      notify.error("Couldn't save the poem", Object.values(found)[0]);
      const first = Object.keys(found)[0];
      document.getElementById(first === "password" ? "password" : first)?.focus();
    } else {
      setClientErrors(null);
    }
  }

  useOnceToast(justCreated ? "Poem created" : null, "created", "Keep editing, or head back to your poems.");

  /** Put a saved version into the editor as unsaved changes; saving as usual keeps it. */
  function restoreVersion(v: SelectedVersion) {
    setTitle(v.title);
    setBody(v.body);
    setLanguage(v.language ?? "");
    setClientErrors(null);
    notify.info("Version restored in the editor", "Save to keep it, or keep editing. Nothing has changed yet.");
  }

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ⌘S / Ctrl+S saves without changing the publish status.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        formRef.current?.requestSubmit(keepStatusRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/admin">
            <ArrowLeftIcon />
            All poems
          </Link>
        </Button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {dirty && <span role="status">Unsaved changes</span>}
          <StatusBadge status={status} />
        </div>
      </div>

      <form
        ref={formRef}
        action={formAction}
        onSubmit={validate}
        className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]"
        noValidate
      >
        {/*
          Pressing Enter in a text field submits with the form's *first* submit
          button. Make that one "keep the current status", so Enter can never
          publish a draft (or unpublish a poem) by accident.
        */}
        <button
          ref={keepStatusRef}
          type="submit"
          name="status"
          value={status}
          disabled={pending}
          tabIndex={-1}
          aria-hidden
          className="sr-only"
        />
        <input type="hidden" name="visibility" value={isPrivate ? "private" : "public"} />

        <div className="grid content-start gap-4">
          {errors.form && (
            <Alert variant="destructive">
              <AlertDescription>{errors.form}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="title" className="sr-only">
              Title
            </Label>
            <Input
              id="title"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              maxLength={TITLE_MAX}
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? "title-error" : undefined}
              autoFocus={!poem}
              className="h-auto border-0 bg-transparent px-0 py-1 font-serif text-3xl shadow-none focus-visible:ring-0 md:text-4xl dark:bg-transparent"
            />
            <FieldError id="title-error" message={errors.title} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="body" className="sr-only">
              Poem
            </Label>
            <Textarea
              id="body"
              name="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => onEmphasisShortcut(e, setBody)}
              placeholder={"Begin here…\n\nLine breaks and indentation are kept exactly as you type them."}
              maxLength={BODY_MAX}
              spellCheck
              aria-invalid={errors.body ? true : undefined}
              aria-describedby={errors.body ? "body-error body-format body-count" : "body-format body-count"}
              className="min-h-[60vh] resize-y bg-card p-5 font-serif text-lg leading-relaxed"
            />
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
              <FieldError id="body-error" message={errors.body} />
              <p id="body-format" className="text-xs text-muted-foreground">
                <span className="font-mono">*italic*</span> and <span className="font-mono">**bold**</span> (⌘I / ⌘B,
                or Ctrl on Windows). Write <span className="font-mono">\*</span> for a plain asterisk.
              </p>
              <p id="body-count" className="ml-auto text-xs text-muted-foreground tabular-nums">
                {body.length.toLocaleString("en")} / {BODY_MAX.toLocaleString("en")}
              </p>
            </div>
            <SpecialLetters fields={BODY_AND_TITLE} className="mt-1" />
          </div>
        </div>

        <aside className="grid content-start gap-4">
          <CardPreview
            title={title}
            body={body}
            isPrivate={isPrivate}
            published={status === "published"}
            penName={penName}
            language={language || null}
          />
          <section className="grid gap-2 rounded-xl border bg-card p-4">
            <Label htmlFor="language" className="text-sm font-medium">
              Language
            </Label>
            <FormSelect
              id="language"
              value={language}
              onValueChange={(v) => setLanguage(v as typeof language)}
              options={[{ value: "", label: "Not set" }, ...POEM_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))]}
              aria-describedby={errors.language ? "language-error language-help" : "language-help"}
              aria-invalid={errors.language ? true : undefined}
              className="w-full"
            />
            <input type="hidden" name="language" value={language} />
            <p id="language-help" className="text-xs text-muted-foreground">
              Shown on the poem, and tells screen readers how to read it.
            </p>
            <FieldError id="language-error" message={errors.language} />

            <Label htmlFor="collection" className="mt-2 text-sm font-medium">
              Collection
            </Label>
            <FormSelect
              id="collection"
              value={collection}
              onValueChange={setCollection}
              options={[{ value: "", label: "None" }, ...collections.map((c) => ({ value: c.id, label: c.title }))]}
              aria-describedby={errors.collection ? "collection-error collection-help" : "collection-help"}
              aria-invalid={errors.collection ? true : undefined}
              className="w-full"
            />
            <input type="hidden" name="collection" value={collection} />
            <p id="collection-help" className="text-xs text-muted-foreground">
              {collection && collection !== saved.collection
                ? "Saving adds it at the end. "
                : collections.length === 0
                  ? "Group poems into an ordered sequence. "
                  : "Readers can read it in order with the others. "}
              <Link href="/admin/collections" className="underline underline-offset-2">
                {collections.length === 0 ? "Create a collection" : "Order collections"}
              </Link>
            </p>
            <FieldError id="collection-error" message={errors.collection} />
          </section>
          <section className="grid gap-3 rounded-xl border bg-card p-4">
            <h2 className="text-sm font-medium">Publishing</h2>
            <p className="text-sm text-muted-foreground">
              {status === "published"
                ? "This poem is on the board. Saving updates it right away."
                : "Drafts are only visible to you."}
            </p>
            <div className="grid gap-2">
              {status === "published" ? (
                <>
                  <SubmitButton status="published" pending={pending}>
                    Save changes
                  </SubmitButton>
                  <SubmitButton status="draft" pending={pending} variant="outline">
                    Unpublish
                  </SubmitButton>
                </>
              ) : (
                <>
                  <SubmitButton status="published" pending={pending}>
                    Publish to board
                  </SubmitButton>
                  <SubmitButton status="draft" pending={pending} variant="outline">
                    Save draft
                  </SubmitButton>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Tip: <kbd className="font-sans">⌘S</kbd> / <kbd className="font-sans">Ctrl S</kbd> saves.
            </p>
          </section>

          <section className="grid gap-3 rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <Label htmlFor="private" className="flex items-center gap-1.5">
                  <LockIcon className="size-3.5" aria-hidden />
                  Password protected
                </Label>
                <p id="private-help" className="text-sm text-muted-foreground">
                  {!isPrivate
                    ? "Anyone can read this poem."
                    : shared
                      ? "Readers see the title on the board and unlock it with your shared password."
                      : "Readers see the title on the board but need the password to read it."}
                </p>
              </div>
              {/* FormSwitch: a plain Switch went back to its value at mount after "Save changes", so a
                  poem made private was sent as public on the next save. The hidden input posts it. */}
              <FormSwitch
                id="private"
                checked={isPrivate}
                onCheckedChange={setIsPrivate}
                aria-describedby="private-help"
              />
            </div>

            {isPrivate && shared && (
              <p className="flex items-start gap-1.5 rounded-lg bg-secondary/60 p-3 text-xs text-secondary-foreground">
                <KeyRoundIcon className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>
                  Uses your shared password for all private poems.{" "}
                  <Link href="/admin/settings" className="underline underline-offset-2">
                    Change in Settings
                  </Link>
                </span>
              </p>
            )}
            {isPrivate && !shared && (
              <div className="grid gap-1.5">
                <Label htmlFor="password">
                  {hasPassword ? "New password" : "Password"}
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder={hasPassword ? "Leave blank to keep current" : `At least ${PASSWORD_MIN} characters`}
                    aria-required={!hasPassword}
                    aria-invalid={errors.password ? true : undefined}
                    aria-describedby={errors.password ? "password-error password-help" : "password-help"}
                    className="pr-9"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1/2 right-1 -translate-y-1/2"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </Button>
                </div>
                <FieldError id="password-error" message={errors.password} />
                <p id="password-help" className="text-xs text-muted-foreground">
                  {hasPassword
                    ? "Changing it locks out readers who used the old one."
                    : "Share it with the readers you want to let in."}
                </p>
              </div>
            )}
            {!isPrivate && saved.isPrivate && !shared && (
              <p className="text-xs text-muted-foreground">
                Saving will remove the current password.
              </p>
            )}
          </section>

          {poem && history && (
            <HistoryPanel basePath={`/admin/poems/${poem.id}`} items={history} selectedId={selectedVersion?.id ?? null} />
          )}

          {poem && deleteAction && <DeletePoem title={saved.title} action={deleteAction} />}
        </aside>
      </form>

      {poem && (
        <VersionDialog
          basePath={`/admin/poems/${poem.id}`}
          version={selectedVersion}
          editor={{ title, body, language }}
          dirty={title !== saved.title || body !== saved.body || language !== saved.language}
          onRestore={restoreVersion}
        />
      )}
    </div>
  );
}

function SubmitButton({
  status,
  pending,
  variant,
  children,
}: {
  status: "draft" | "published";
  pending: boolean;
  variant?: "outline";
  children: React.ReactNode;
}) {
  return (
    <Button
      type="submit"
      name="status"
      value={status}
      variant={variant}
      size="lg"
      disabled={pending}
    >
      {children}
    </Button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

function DeletePoem({ title, action }: { title: string; action: () => Promise<void> }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" className="justify-start text-destructive hover:text-destructive">
          <Trash2Icon />
          Delete poem
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{title || "Untitled"}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            It will be removed from the board and can&apos;t be recovered.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* A separate form: the dialog is portalled outside the poem form. */}
        <form
          action={async () => {
            try {
              await action(); // redirects to the dashboard on success
            } catch (err) {
              unstable_rethrow(err);
              notify.error("Couldn't delete the poem", "Please try again in a moment.");
            }
          }}
        >
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <ConfirmDelete />
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmDelete() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending && <Loader2Icon className="animate-spin" />}
      Delete poem
    </Button>
  );
}
