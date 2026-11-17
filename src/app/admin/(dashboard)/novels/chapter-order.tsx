"use client";

import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { StatusBadge } from "@/components/poem-badges";
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
import { chapterDisplayTitle, CHAPTERS_MAX } from "@/lib/novel-limits";
import { notify, UNEXPECTED_ERROR } from "@/lib/notify";
import { pluralCount } from "@/lib/plural";
import { createChapterAction, deleteNovelAction, moveChapterAction, reorderChaptersAction } from "./actions";
import { TOUCH } from "./novel-forms";

/*
 * A novel's chapters in reading order (docs/PLAN.md, Phase 23a), ordered like
 * a collection's poems (CLAUDE.md, Collections): Move up / Move down buttons
 * named after each chapter are the keyboard and screen-reader path
 * (aria-disabled, never disabled, so focus survives reaching an end; focus
 * follows the chapter and a live region says where it went); a grip handle
 * drags with a pointer only. A drop shows at once, saves the whole order,
 * and rolls back with a toast if the server refuses it (stale or gone).
 */

export type OrderChapter = {
  id: string;
  title: string;
  status: "draft" | "published";
  wordCount: number;
  /** Server-formatted. */
  updatedLabel: string;
};

export function ChapterOrder({ novelId, chapters }: { novelId: string; chapters: OrderChapter[] }) {
  const [pending, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const focusNext = useRef<string | null>(null);
  const [dropped, setDropped] = useState<string[] | null>(null);
  const order = chapters.map((c) => c.id).join(",");
  const [seenOrder, setSeenOrder] = useState(order);
  if (seenOrder !== order) {
    setSeenOrder(order);
    setDropped(null);
  }
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const shown = dropped?.every((id) => byId.has(id)) ? dropped.map((id) => byId.get(id)!) : chapters;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const published = chapters.filter((c) => c.status === "published").length;

  useLayoutEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    document.querySelector<HTMLElement>(target)?.focus();
  }, [order]);

  const run = (task: () => Promise<(() => void) | void>) => {
    if (pending) return;
    startTransition(async () => {
      try {
        const done = await task();
        // Part of the action: commits together with the refreshed list.
        if (done) startTransition(done);
      } catch (err) {
        unstable_rethrow(err);
        notify.error(UNEXPECTED_ERROR.title, "Please try again in a moment.");
      }
    });
  };

  const move = (c: OrderChapter, index: number, direction: "up" | "down") =>
    run(async () => {
      const res = await moveChapterAction(novelId, c.id, direction);
      if (!res.ok) {
        notify.error("Couldn't move the chapter", res.error);
        return;
      }
      return () => {
        focusNext.current = `[data-move="${direction}"][data-chapter="${c.id}"]`;
        setAnnouncement(`Moved “${chapterDisplayTitle(c.title, index + 1)}” to position ${res.position} of ${res.total}.`);
      };
    });

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || pending) return;
    const ids = shown.map((c) => c.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    const c = byId.get(String(active.id))!;
    setDropped(next);
    run(async () => {
      const res = await reorderChaptersAction(novelId, next);
      if (!res.ok) {
        notify.error("Couldn't save the new order", res.error);
        return () => setDropped(null);
      }
      return () => setAnnouncement(`Moved “${chapterDisplayTitle(c.title, ids.indexOf(c.id) + 1)}” to position ${next.indexOf(c.id) + 1} of ${next.length}.`);
    });
  };

  const add = () =>
    run(async () => {
      const res = await createChapterAction(novelId); // opens the new chapter on success
      if (res && !res.ok) notify.error("Couldn't add a chapter", res.error);
    });

  return (
    <section aria-labelledby="chapters-heading" className="grid gap-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="chapters-heading" className="font-serif text-xl">
          Chapters, in reading order
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums">
          {pluralCount(chapters.length, "chapter")} · {published} published
        </span>
      </div>
      <p id="chapter-order-help" className="text-sm text-muted-foreground">
        Readers see published chapters in this order, numbered without drafts. Drag a chapter by its handle, or use the
        arrow buttons to move it.
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {chapters.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No chapters yet. Add the first one below.
        </p>
      ) : (
        <DndContext
          id={`chapters-${novelId}`}
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={onDragEnd}
          accessibility={{ screenReaderInstructions: { draggable: "" }, announcements: NO_ANNOUNCEMENTS }}
        >
          <SortableContext items={shown.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <ol className="grid grid-cols-[minmax(0,1fr)] gap-2" aria-describedby="chapter-order-help" aria-busy={pending || undefined}>
              {shown.map((c, i) => {
                const label = chapterDisplayTitle(c.title, i + 1);
                return (
                  <SortableRow key={c.id} id={c.id} title={label}>
                    <span className="w-7 shrink-0 text-right font-mono text-sm text-muted-foreground tabular-nums" aria-hidden>
                      {i + 1}.
                    </span>
                    <span className="min-w-0 flex-1">
                      <Link
                        href={`/admin/novels/${novelId}/chapters/${c.id}`}
                        data-chapter-link={c.id}
                        className="block truncate font-serif text-[15px] underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        {label}
                      </Link>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <StatusBadge status={c.status} />
                        <span className="tabular-nums">{pluralCount(c.wordCount, "word")}</span>
                        <span className="max-sm:sr-only">· edited {c.updatedLabel}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <OrderButton
                        label={`Move “${label}” up`}
                        data-move="up"
                        data-chapter={c.id}
                        unavailable={i === 0 || pending}
                        onPress={() => move(c, i, "up")}
                      >
                        <ArrowUpIcon />
                      </OrderButton>
                      <OrderButton
                        label={`Move “${label}” down`}
                        data-move="down"
                        data-chapter={c.id}
                        unavailable={i === shown.length - 1 || pending}
                        onPress={() => move(c, i, "down")}
                      >
                        <ArrowDownIcon />
                      </OrderButton>
                    </span>
                  </SortableRow>
                );
              })}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          aria-disabled={pending || chapters.length >= CHAPTERS_MAX || undefined}
          onClick={() => chapters.length < CHAPTERS_MAX && add()}
          className={TOUCH}
        >
          {pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
          New chapter
        </Button>
        <p className="text-xs text-muted-foreground">
          {chapters.length >= CHAPTERS_MAX
            ? `A novel can have at most ${CHAPTERS_MAX} chapters.`
            : "A new chapter starts as an empty draft at the end."}
        </p>
      </div>
    </section>
  );
}

const NO_ANNOUNCEMENTS = { onDragStart: () => undefined, onDragOver: () => undefined, onDragEnd: () => undefined, onDragCancel: () => undefined };

function SortableRow({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      data-order-row={id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative flex min-w-0 items-center gap-2 rounded-lg border bg-background p-2 pl-1 ${isDragging ? "z-10 shadow-lg ring-2 ring-ring/40" : ""}`}
    >
      <span
        ref={setActivatorNodeRef}
        {...listeners}
        // Pointer-only: the Move buttons are the keyboard and screen-reader path.
        aria-hidden
        data-drag-handle={id}
        title={`Drag “${title}” to reorder`}
        className="flex h-11 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing"
      >
        <GripVerticalIcon className="size-4" />
      </span>
      {children}
    </li>
  );
}

function OrderButton({
  label,
  unavailable,
  onPress,
  children,
  ...data
}: {
  label: string;
  unavailable: boolean;
  onPress: () => void;
  children: React.ReactNode;
} & Record<`data-${string}`, string>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-disabled={unavailable || undefined}
      onClick={() => !unavailable && onPress()}
      className="aria-disabled:opacity-40 max-sm:size-11"
      {...data}
    >
      {children}
    </Button>
  );
}

export function DeleteNovel({ title, novelId, chapterCount }: { title: string; novelId: string; chapterCount: number }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" className={`justify-self-start text-destructive hover:text-destructive ${TOUCH}`}>
          <Trash2Icon />
          Delete novel
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{title}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            {chapterCount > 0
              ? `Its ${pluralCount(chapterCount, "chapter")} and their saved versions go with it. This can't be undone.`
              : "This can't be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          action={async () => {
            try {
              await deleteNovelAction(novelId); // redirects on success
            } catch (err) {
              unstable_rethrow(err);
              notify.error("Couldn't delete the novel", "Please try again in a moment.");
            }
          }}
        >
          <AlertDialogFooter>
            <AlertDialogCancel type="button" className={TOUCH}>
              Cancel
            </AlertDialogCancel>
            <ConfirmDelete label="Delete novel" />
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ConfirmDelete({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending} className={TOUCH}>
      {pending && <Loader2Icon className="animate-spin" />}
      {label}
    </Button>
  );
}
