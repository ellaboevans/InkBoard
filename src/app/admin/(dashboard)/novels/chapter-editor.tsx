"use client";

import { ArrowLeftIcon, ArrowRightIcon, BoldIcon, ItalicIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ProseText } from "@/components/novel/prose-text";
import { StatusBadge } from "@/components/poem-badges";
import { SpecialLetters } from "@/components/special-letters";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useOnceToast } from "@/hooks/use-once-toast";
import { chapterDraftKey, parseDraft, serializeDraft, shouldOfferDraft, type ChapterDraft } from "@/lib/chapter-draft";
import { CHAPTER_BODY_MAX, CHAPTER_TITLE_MAX, chapterDisplayTitle, readingMinutes } from "@/lib/novel-limits";
import { notify, withErrorToast } from "@/lib/notify";
import { pluralCount } from "@/lib/plural";
import { toggleEmphasis, type TextEdit } from "@/lib/poem-markdown";
import { countWords } from "@/lib/prose";
import { HistoryPanel, VersionDialog, type HistoryItem, type SelectedVersion } from "../poems/poem-history";
import { deleteChapterAction, saveChapterAction, type ChapterFormState } from "./actions";
import { ConfirmDelete } from "./chapter-order";
import { FieldError, TOUCH } from "./novel-forms";

/*
 * The chapter editor (docs/PLAN.md, Phase 23a; the look of
 * docs/mockups/novels/chapter-editor.html). Prose rules are src/lib/prose.ts;
 * Preview renders exactly what readers will get (ProseText).
 *
 * - Controlled fields (CLAUDE.md), and the form's first submit button is a
 *   hidden "keep the current status", so Enter or ⌘S never publishes.
 * - Autosave on the device: while the text differs from the saved chapter,
 *   it's kept in localStorage (src/lib/chapter-draft.ts) a moment after each
 *   change, and removed after a successful save. Opening the chapter again
 *   offers to restore a draft that's newer than the saved chapter and
 *   different from it; once the writer types, the offer goes away. Because
 *   of this, the page doesn't block leaving with a "beforeunload" prompt.
 * - History: the poems' panel and dialog; restoring only fills the form.
 */

const BODY_ID = "chapter-body";
const LETTER_FIELDS = [BODY_ID, "title"];
const SCENE_BREAK = "* * *";

export type ChapterEditorProps = {
  novel: { id: string; title: string; language: string | null };
  chapter: {
    id: string;
    title: string;
    body: string;
    status: "draft" | "published";
    /** 1-based, over all chapters (drafts included). */
    position: number;
    total: number;
    /** Last saved, ms (to compare with a device draft). */
    updatedAt: number;
    savedLabel: string;
  };
  publishedCount: number;
  prev: { id: string; label: string; n: number } | null;
  next: { id: string; label: string; n: number } | null;
  justCreated: boolean;
  history: HistoryItem[];
  selectedVersion: SelectedVersion | null;
};

// ---- the device draft --------------------------------------------------------

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null; // private mode or blocked storage: no autosave, nothing breaks
  }
};

function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** The stored draft's raw string (stable between reads), or null; null on the server. */
function useStoredDraft(key: string): string | null {
  return useSyncExternalStore(
    subscribeStorage,
    () => {
      try {
        return storage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    () => null,
  );
}

function writeDraft(key: string, draft: ChapterDraft | null) {
  try {
    if (draft) storage()?.setItem(key, serializeDraft(draft));
    else storage()?.removeItem(key);
  } catch {
    // Full or blocked: the server save still works.
  }
}

/**
 * Each chapter's last successful save in this tab, set the moment the save
 * returns (before React commits it), so an autosave timer that fires in
 * between can't write the just-saved text back as an unsaved draft.
 */
const lastSaved = new Map<string, { title: string; body: string; at: number }>();

// ---- text editing helpers -------------------------------------------------------

/** Apply an edit through the browser's editing path (undo works, onChange fires); fall back to setting the value. */
function applyEdit(el: HTMLTextAreaElement, edit: TextEdit, setBody: (v: string) => void) {
  if (el.value.length - (edit.to - edit.from) + edit.insert.length > CHAPTER_BODY_MAX) return;
  el.focus();
  el.setSelectionRange(edit.from, edit.to);
  if (!document.execCommand("insertText", false, edit.insert)) {
    setBody(el.value.slice(0, edit.from) + edit.insert + el.value.slice(edit.to));
    requestAnimationFrame(() => el.setSelectionRange(edit.selStart, edit.selEnd));
    return;
  }
  el.setSelectionRange(edit.selStart, edit.selEnd);
}

/** A scene break on its own line, with a blank line on each side. */
function sceneBreakEdit(value: string, start: number, end: number): TextEdit {
  const before = value.slice(0, start).replace(/[ \t]+$/, "");
  const after = value.slice(end).replace(/^[ \t]+/, "");
  const lead = before === "" ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const insert = `${lead}${SCENE_BREAK}${trail}`;
  const from = before.length;
  const to = value.length - after.length;
  const caret = from + insert.length;
  return { from, to, insert, selStart: caret, selEnd: caret };
}

// ---- the editor ---------------------------------------------------------------

export function ChapterEditor({ novel, chapter, publishedCount, prev, next, justCreated, history, selectedVersion }: ChapterEditorProps) {
  const basePath = `/admin/novels/${novel.id}/chapters/${chapter.id}`;
  const draftKey = chapterDraftKey(chapter.id);
  const formRef = useRef<HTMLFormElement>(null);
  const keepStatusRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [title, setTitle] = useState(chapter.title);
  const [body, setBody] = useState(chapter.body);
  const [saved, setSaved] = useState({ title: chapter.title, body: chapter.body, updatedAt: chapter.updatedAt });
  // Typing (or restoring) since the page opened: the device-draft offer is then moot.
  const [touched, setTouched] = useState(false);
  const [draftDismissed, setDraftDismissed] = useState(false);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [clientError, setClientError] = useState<string | null>(null);

  const [state, formAction, pending] = useActionState(
    withErrorToast(async (prevState: ChapterFormState, formData: FormData) => {
      const res = await saveChapterAction(chapter.id, prevState, formData);
      if (res.savedAt) {
        // Saved on the server: the device copy has done its job.
        lastSaved.set(chapter.id, { title: String(formData.get("title") ?? ""), body: String(formData.get("body") ?? ""), at: res.savedAt });
        writeDraft(draftKey, null);
        const unpublished = prevState.status === "published" && res.status === "draft";
        notify.success(
          res.publishedNow ? "Chapter published" : unpublished ? "Chapter unpublished" : res.status === "published" ? "Chapter saved" : "Draft saved",
          res.status === "published"
            ? "Readers will see published chapters when novels come to the board."
            : "Drafts are only visible to you.",
        );
      } else if (res.errors) {
        notify.error("Couldn't save the chapter", res.errors.form ?? Object.values(res.errors)[0]);
      }
      return res;
    }),
    { status: chapter.status },
  );

  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    if (state.savedAt) setSaved({ title, body, updatedAt: state.savedAt });
  }

  const status = state.status ?? chapter.status;
  const dirty = title !== saved.title || body !== saved.body;
  const errors = { ...state.errors, ...(clientError ? { body: clientError } : {}) };
  const words = countWords(body);
  const n = chapter.position;

  // The device draft: offered once, when the page opens with one that's newer.
  const rawDraft = useStoredDraft(draftKey);
  const draft = parseDraft(rawDraft);
  const offer = !touched && !draftDismissed && shouldOfferDraft(draft, saved) ? draft : null;

  // Keep the device copy in step with the text, a moment after each change.
  // Decided when the timer fires, from refs: if a save succeeded meanwhile,
  // the text is no longer unsaved and nothing is written back.
  useEffect(() => {
    if (!touched) return;
    const t = setTimeout(() => {
      const recorded = lastSaved.get(chapter.id);
      const base = recorded && recorded.at >= chapter.updatedAt ? recorded : chapter;
      const unsaved = title !== base.title || body !== base.body;
      writeDraft(draftKey, unsaved ? { title, body, at: Date.now() } : null);
    }, 400);
    return () => clearTimeout(t);
  }, [draftKey, title, body, touched, chapter]);

  // ⌘S / Ctrl+S saves without changing the status.
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

  useOnceToast(justCreated ? "Chapter added" : null, "created", "Write it here; it stays a draft until you publish it.");

  const edit = (v: string) => {
    setTouched(true);
    setBody(v);
  };

  function emphasis(marker: "*" | "**") {
    const el = bodyRef.current;
    if (!el) return;
    applyEdit(el, toggleEmphasis(el.value, el.selectionStart, el.selectionEnd, marker), edit);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const key = e.key.toLowerCase();
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    if (!(isMac ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey || (key !== "b" && key !== "i")) return;
    e.preventDefault();
    emphasis(key === "b" ? "**" : "*");
  }

  function sceneBreak() {
    const el = bodyRef.current;
    if (!el) return;
    applyEdit(el, sceneBreakEdit(el.value, el.selectionStart, el.selectionEnd), edit);
  }

  function restoreDraft(d: ChapterDraft) {
    setTitle(d.title);
    setBody(d.body);
    setTouched(true);
    notify.info("Draft restored", "Save to keep it. Nothing on InkBoard has changed yet.");
  }

  function discardDraft() {
    writeDraft(draftKey, null);
    setDraftDismissed(true);
  }

  function restoreVersion(v: SelectedVersion) {
    setTitle(v.title);
    setBody(v.body);
    setTouched(true);
    setClientError(null);
    notify.info("Version restored in the editor", "Save to keep it, or keep editing. Nothing has changed yet.");
  }

  function validate(e: React.FormEvent<HTMLFormElement>) {
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value === "published" && !body.trim()) {
      e.preventDefault();
      const message = "The chapter is empty: write something before publishing it";
      setClientError(message);
      setTab("write");
      notify.error("Couldn't publish the chapter", message);
      requestAnimationFrame(() => bodyRef.current?.focus());
      return;
    }
    setClientError(null);
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5">
      <nav aria-label="Chapters" className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm" className={`-ml-2 ${TOUCH}`}>
          <Link href={`/admin/novels/${novel.id}`}>
            <ArrowLeftIcon />
            <span className="max-w-[14rem] truncate">{novel.title}</span>
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          {prev && (
            <Button asChild variant="outline" size="sm" className={TOUCH}>
              <Link href={`/admin/novels/${novel.id}/chapters/${prev.id}`}>
                <ArrowLeftIcon />
                <span className="sr-only">Previous: </span>Chapter {prev.n}
                {prev.label !== `Chapter ${prev.n}` && <span className="sr-only">, {prev.label}</span>}
              </Link>
            </Button>
          )}
          {next && (
            <Button asChild variant="outline" size="sm" className={TOUCH}>
              <Link href={`/admin/novels/${novel.id}/chapters/${next.id}`}>
                <span className="sr-only">Next: </span>Chapter {next.n}
                {next.label !== `Chapter ${next.n}` && <span className="sr-only">, {next.label}</span>}
                <ArrowRightIcon />
              </Link>
            </Button>
          )}
        </div>
      </nav>

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <StatusBadge status={status} />
        <span>
          Chapter {n} of {chapter.total} · readers see {pluralCount(publishedCount, "published chapter")}
        </span>
        {dirty && (
          <span role="status" className="ml-auto">
            Unsaved changes
          </span>
        )}
      </div>

      {offer && (
        <Alert data-device-draft>
          <AlertTitle>A newer draft is saved on this device</AlertTitle>
          <AlertDescription>
            <p>
              From {new Date(offer.at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}, not saved to
              InkBoard yet ({pluralCount(countWords(offer.body), "word")}).
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" className={TOUCH} onClick={() => restoreDraft(offer)}>
                Restore draft
              </Button>
              <Button type="button" size="sm" variant="outline" className={TOUCH} onClick={discardDraft}>
                Discard it
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <form ref={formRef} action={formAction} onSubmit={validate} className="grid gap-4" noValidate>
        {/* Enter submits with the first submit button: keep the current status. */}
        <button ref={keepStatusRef} type="submit" name="status" value={status} disabled={pending} tabIndex={-1} aria-hidden className="sr-only" />
        <input type="hidden" name="body" value={body} />

        {errors.form && (
          <Alert variant="destructive">
            <AlertDescription>{errors.form}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="title">
            Chapter title{" "}
            <span className="font-normal text-muted-foreground">(optional: empty shows &ldquo;Chapter {n}&rdquo;)</span>
          </Label>
          <Input
            id="title"
            name="title"
            value={title}
            onChange={(e) => {
              setTouched(true);
              setTitle(e.target.value);
            }}
            maxLength={CHAPTER_TITLE_MAX}
            placeholder={`Chapter ${n}`}
            lang={novel.language ?? undefined}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? "title-error" : undefined}
            className="h-auto min-h-11 bg-card py-2 font-serif text-2xl md:text-[28px]"
          />
          <FieldError id="title-error" message={errors.title} />
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "write" | "preview")} className="gap-0">
          <div className="flex flex-wrap items-center gap-1.5 rounded-t-lg border border-b-0 border-input bg-card p-2">
            <span id="body-label" className="sr-only">
              Text
            </span>
            {tab === "write" && (
              <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-1.5">
                <ToolButton label="Italic" shortcut="⌘I" onPress={() => emphasis("*")}>
                  <ItalicIcon />
                </ToolButton>
                <ToolButton label="Bold" shortcut="⌘B" onPress={() => emphasis("**")}>
                  <BoldIcon />
                </ToolButton>
                <ToolButton label="Scene break" onPress={sceneBreak}>
                  <span aria-hidden className="font-serif text-base leading-none">⁂</span>
                </ToolButton>
              </div>
            )}
            <TabsList className="ml-auto max-sm:h-11!">
              <TabsTrigger value="write" className={TOUCH}>
                Write
              </TabsTrigger>
              <TabsTrigger value="preview" className={TOUCH}>
                Preview
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="write" className="mt-0">
            <Textarea
              ref={bodyRef}
              id={BODY_ID}
              value={body}
              onChange={(e) => edit(e.target.value)}
              onKeyDown={onKeyDown}
              maxLength={CHAPTER_BODY_MAX}
              spellCheck
              lang={novel.language ?? undefined}
              aria-labelledby="body-label"
              aria-invalid={errors.body ? true : undefined}
              aria-describedby={`chapter-count chapter-help${errors.body ? " body-error" : ""}`}
              placeholder={"Begin here…\n\nA blank line starts a new paragraph."}
              className="min-h-[60vh] resize-y rounded-t-none bg-card p-4 font-serif text-lg leading-[1.7] sm:p-5 md:text-lg"
            />
          </TabsContent>
          <TabsContent value="preview" className="mt-0">
            <div className="min-h-[60vh] rounded-b-lg border border-input bg-card p-4 sm:p-6">
              {body.trim() ? (
                <article
                  lang={novel.language ?? undefined}
                  aria-label={`Preview of ${chapterDisplayTitle(title, n)}`}
                  className="mx-auto max-w-[34em] font-serif text-[19px] leading-[1.7] hyphens-auto [&_p]:indent-[1.5em] [&_h2+p]:indent-0 [&_[data-scene-break]+p]:indent-0"
                >
                  <h2 className="mb-6 font-serif text-3xl leading-tight">{chapterDisplayTitle(title, n)}</h2>
                  <ProseText text={body} />
                </article>
              ) : (
                <p className="text-center text-muted-foreground">Nothing to preview yet.</p>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <div className="grid gap-2">
          <FieldError id="body-error" message={errors.body} />
          <p id="chapter-count" className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
            <span>
              {pluralCount(words, "word")} · about {pluralCount(Math.max(1, readingMinutes(words)), "minute")} to read
            </span>
            <span className={body.length > CHAPTER_BODY_MAX * 0.9 ? "text-destructive" : undefined}>
              {body.length.toLocaleString("en")} of {CHAPTER_BODY_MAX.toLocaleString("en")} characters
            </span>
          </p>
          <p id="chapter-help" className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            A blank line starts a new paragraph; a single line break is kept. A line with only{" "}
            <span className="font-mono">* * *</span> is a scene break. <span className="font-mono">*italic*</span> and{" "}
            <span className="font-mono">**bold**</span> (⌘I / ⌘B, or Ctrl on Windows); <span className="font-mono">\*</span> for a
            plain asterisk.
          </p>
          <SpecialLetters fields={LETTER_FIELDS} />
        </div>

        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
          <p className="mr-auto text-xs text-muted-foreground max-sm:basis-full">
            Saved to InkBoard {saved.updatedAt === chapter.updatedAt ? chapter.savedLabel : "just now"} ·{" "}
            <a href="#history" className="underline underline-offset-2">
              History ({history.length})
            </a>
          </p>
          {status === "published" ? (
            <>
              <SubmitButton status="draft" pending={pending} variant="outline">
                Unpublish
              </SubmitButton>
              <SubmitButton status="published" pending={pending}>
                Save changes
              </SubmitButton>
            </>
          ) : (
            <>
              <SubmitButton status="draft" pending={pending} variant="outline">
                Save draft
              </SubmitButton>
              <SubmitButton status="published" pending={pending}>
                Publish chapter
              </SubmitButton>
            </>
          )}
        </div>
      </form>

      <HistoryPanel basePath={basePath} items={history} selectedId={selectedVersion?.id ?? null} changesWhat="the title or text" />
      <DeleteChapter title={chapterDisplayTitle(saved.title, n)} novelId={novel.id} chapterId={chapter.id} />

      <VersionDialog
        basePath={basePath}
        version={selectedVersion}
        editor={{ title, body }}
        dirty={dirty}
        onRestore={restoreVersion}
      />
    </div>
  );
}

function ToolButton({ label, shortcut, onPress, children }: { label: string; shortcut?: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      // Keep the selection in the text area while pressing.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`${TOUCH} max-sm:min-w-11`}
    >
      {children}
      <span className="max-sm:sr-only">{label}</span>
    </Button>
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
    <Button type="submit" name="status" value={status} variant={variant} disabled={pending} className={`${TOUCH} max-sm:flex-1`}>
      {pending && <Loader2Icon className="animate-spin" />}
      {children}
    </Button>
  );
}

function DeleteChapter({ title, novelId, chapterId }: { title: string; novelId: string; chapterId: string }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" className={`justify-self-start text-destructive hover:text-destructive ${TOUCH}`}>
          <Trash2Icon />
          Delete chapter
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{title}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            The chapter and its saved versions go; the others close up. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          action={async () => {
            try {
              await deleteChapterAction(novelId, chapterId); // redirects on success
            } catch (err) {
              unstable_rethrow(err);
              notify.error("Couldn't delete the chapter", "Please try again in a moment.");
            }
          }}
        >
          <AlertDialogFooter>
            <AlertDialogCancel type="button" className={TOUCH}>
              Cancel
            </AlertDialogCancel>
            <ConfirmDelete label="Delete chapter" />
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

