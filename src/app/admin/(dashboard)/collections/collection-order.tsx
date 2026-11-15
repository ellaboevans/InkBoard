"use client";

import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, Loader2Icon, LockIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { unstable_rethrow } from "next/navigation";
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
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { COLLECTION_POEMS_MAX } from "@/lib/collection-limits";
import { notify, UNEXPECTED_ERROR } from "@/lib/notify";
import { pluralCount } from "@/lib/plural";
import {
  deleteCollectionAction,
  moveCollectionPoemAction,
  reorderCollectionAction,
  setPoemCollectionAction,
} from "./actions";

/*
 * Ordering a collection (docs/PLAN.md, Phase 14), keyboard first: every poem
 * has Move up / Move down buttons named after it. Moves are relative and
 * applied on the server under the editor's lock, then the page refreshes.
 *
 * Buttons use aria-disabled, never `disabled`: a disabled button drops focus,
 * so the one you just pressed (now at the top, say) would lose it. After a
 * move, focus follows the poem, and a live region says where it went.
 *
 * The announcement and the focus target are set inside the same transition
 * as the action, so they commit together with the refreshed order. Set after
 * the await as plain updates, they rendered first: "Moved" was announced
 * while the old order was still on screen, and focus jumped a moment later.
 *
 * Drag and drop (@dnd-kit) is an extra for pointers: only the grip handle
 * starts a drag (mouse, touch, pen), so a long list still scrolls on a phone.
 * The handle is hidden from assistive tech and not focusable; the Move
 * buttons stay the keyboard and screen-reader path. A drop shows the new
 * order at once (local state), saves it with one action (the same locked,
 * editor-scoped server code), and rolls back with a toast if that fails.
 */

export type OrderPoem = {
  id: string;
  title: string;
  status: "draft" | "published";
  visibility: "public" | "private";
};

type Direction = "up" | "down";

export function CollectionOrder({
  collectionId,
  poems,
  available,
}: {
  collectionId: string;
  poems: OrderPoem[];
  /** The editor's poems in no collection, to add. */
  available: { id: string; title: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const [adding, setAdding] = useState("");
  // Where focus should go once the refreshed order renders.
  const focusNext = useRef<string | null>(null);
  // A dropped order, shown until the refreshed list arrives (or rolled back).
  const [dropped, setDropped] = useState<string[] | null>(null);
  const order = poems.map((p) => p.id).join(",");
  const [seenOrder, setSeenOrder] = useState(order);
  if (seenOrder !== order) {
    setSeenOrder(order);
    setDropped(null);
  }
  const byId = new Map(poems.map((p) => [p.id, p]));
  const shown = dropped?.every((id) => byId.has(id)) ? dropped.map((id) => byId.get(id)!) : poems;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

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
        // Part of the action: commits with the refreshed list (see above).
        if (done) startTransition(done);
      } catch (err) {
        unstable_rethrow(err);
        notify.error(UNEXPECTED_ERROR.title, "Please try again in a moment.");
      }
    });
  };

  const move = (poem: OrderPoem, direction: Direction) =>
    run(async () => {
      const res = await moveCollectionPoemAction(collectionId, poem.id, direction);
      if (!res.ok) {
        notify.error("Couldn't move the poem", res.error);
        return;
      }
      return () => {
        focusNext.current = `[data-move="${direction}"][data-poem="${poem.id}"]`;
        setAnnouncement(`Moved “${res.title}” to position ${res.position} of ${res.total}.`);
      };
    });

  const remove = (poem: OrderPoem, index: number) =>
    run(async () => {
      const res = await setPoemCollectionAction(poem.id, null);
      if (!res.ok) {
        notify.error("Couldn't remove the poem", res.error);
        return;
      }
      // Focus the next poem's Remove (or the previous one's, or the Add picker).
      const neighbour = poems[index + 1] ?? poems[index - 1];
      return () => {
        focusNext.current = neighbour ? `[data-remove="${neighbour.id}"]` : "#add-poem";
        setAnnouncement(`Removed “${poem.title}” from the collection. It's still in your poems.`);
      };
    });

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || pending) return;
    const ids = shown.map((p) => p.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    const poem = byId.get(String(active.id))!;
    setDropped(next); // at once, before the save
    run(async () => {
      const res = await reorderCollectionAction(collectionId, next);
      if (!res.ok) {
        notify.error("Couldn't save the new order", res.error);
        return () => setDropped(null); // roll back
      }
      return () => {
        setAnnouncement(`Moved “${poem.title}” to position ${next.indexOf(poem.id) + 1} of ${next.length}.`);
      };
    });
  };

  const add = () =>
    run(async () => {
      const poem = available.find((p) => p.id === adding);
      if (!poem) return;
      const res = await setPoemCollectionAction(poem.id, collectionId);
      if (!res.ok) {
        notify.error("Couldn't add the poem", res.error);
        return;
      }
      return () => {
        setAdding("");
        focusNext.current = "#add-poem";
        setAnnouncement(`Added “${poem.title}” at position ${poems.length + 1}.`);
      };
    });

  return (
    <section aria-labelledby="collection-poems" className="grid gap-4 rounded-xl border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="collection-poems" className="font-serif text-xl">
          Poems, in reading order
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums">{pluralCount(poems.length, "poem")}</span>
      </div>
      <p id="order-help" className="text-sm text-muted-foreground">
        Readers see published poems in this order, numbered without drafts. Drag a poem by its handle, or use the
        arrow buttons to move it.
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {poems.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No poems yet. Add one below, or pick this collection in the poem editor.
        </p>
      ) : (
        <DndContext
          id={`order-${collectionId}`}
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={onDragEnd}
          // Spoken drag announcements aren't needed: the handle is pointer-only.
          accessibility={{ screenReaderInstructions: { draggable: "" }, announcements: NO_ANNOUNCEMENTS }}
        >
        <SortableContext items={shown.map((p) => p.id)} strategy={verticalListSortingStrategy}>
        {/* minmax(0,1fr): a grid item's min-width is its content by default, so a long title overflowed phones. */}
        <ol className="grid grid-cols-[minmax(0,1fr)] gap-2" aria-describedby="order-help" aria-busy={pending || undefined}>
          {shown.map((p, i) => (
            <SortableRow key={p.id} id={p.id} title={p.title}>
              <span className="w-6 shrink-0 text-right font-mono text-sm text-muted-foreground tabular-nums" aria-hidden>
                {i + 1}.
              </span>
              <span className="min-w-0 flex-1">
                <Link
                  href={`/admin/poems/${p.id}`}
                  className="block truncate font-serif text-[15px] underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {p.title}
                </Link>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <StatusBadge status={p.status} />
                  {p.visibility === "private" && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <LockIcon className="size-3" aria-hidden />
                      <span className="max-sm:sr-only">Password protected</span>
                    </span>
                  )}
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                <OrderButton
                  label={`Move “${p.title}” up`}
                  data-move="up"
                  data-poem={p.id}
                  unavailable={i === 0 || pending}
                  onPress={() => move(p, "up")}
                >
                  <ArrowUpIcon />
                </OrderButton>
                <OrderButton
                  label={`Move “${p.title}” down`}
                  data-move="down"
                  data-poem={p.id}
                  unavailable={i === shown.length - 1 || pending}
                  onPress={() => move(p, "down")}
                >
                  <ArrowDownIcon />
                </OrderButton>
                <OrderButton
                  label={`Remove “${p.title}” from the collection`}
                  data-remove={p.id}
                  unavailable={pending}
                  onPress={() => remove(p, i)}
                >
                  <XIcon />
                </OrderButton>
              </span>
            </SortableRow>
          ))}
        </ol>
        </SortableContext>
        </DndContext>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="add-poem">Add a poem</Label>
        <div className="flex flex-wrap gap-2">
          <NativeSelect
            id="add-poem"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            aria-describedby="add-help"
            // Wraps above the button on phones instead of truncating.
            className="min-w-56 flex-1"
          >
            <NativeSelectOption value="">
              {available.length ? "Choose one of your poems…" : "All your poems are in collections"}
            </NativeSelectOption>
            {available.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            type="button"
            variant="outline"
            aria-disabled={!adding || pending || poems.length >= COLLECTION_POEMS_MAX || undefined}
            onClick={() => adding && poems.length < COLLECTION_POEMS_MAX && add()}
          >
            {pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
            Add to collection
          </Button>
        </div>
        <p id="add-help" className="text-xs text-muted-foreground">
          Poems that aren&apos;t in a collection. It goes at the end. Up to {COLLECTION_POEMS_MAX} poems.
        </p>
      </div>
    </section>
  );
}

const NO_ANNOUNCEMENTS = { onDragStart: () => undefined, onDragOver: () => undefined, onDragEnd: () => undefined, onDragCancel: () => undefined };

/** A row that can be dragged by its grip handle only. */
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
        className="flex h-9 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing"
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
      className="aria-disabled:opacity-40"
      {...data}
    >
      {children}
    </Button>
  );
}

export function DeleteCollection({ title, collectionId }: { title: string; collectionId: string }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" className="justify-self-start text-destructive hover:text-destructive">
          <Trash2Icon />
          Delete collection
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{title}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            The collection goes away; its poems stay, just not in a collection.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          action={async () => {
            try {
              await deleteCollectionAction(collectionId); // redirects on success
            } catch (err) {
              unstable_rethrow(err);
              notify.error("Couldn't delete the collection", "Please try again in a moment.");
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
      Delete collection
    </Button>
  );
}
