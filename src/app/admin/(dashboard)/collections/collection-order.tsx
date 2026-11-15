"use client";

import { ArrowDownIcon, ArrowUpIcon, Loader2Icon, LockIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
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
import { deleteCollectionAction, moveCollectionPoemAction, setPoemCollectionAction } from "./actions";

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
  const order = poems.map((p) => p.id).join(",");

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
        Readers see published poems in this order, numbered without drafts. Use the arrow buttons to move a poem.
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {poems.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No poems yet. Add one below, or pick this collection in the poem editor.
        </p>
      ) : (
        <ol className="grid gap-2" aria-describedby="order-help" aria-busy={pending || undefined}>
          {poems.map((p, i) => (
            <li key={p.id} className="flex items-center gap-2 rounded-lg border bg-background p-2">
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
                  unavailable={i === poems.length - 1 || pending}
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
            </li>
          ))}
        </ol>
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
