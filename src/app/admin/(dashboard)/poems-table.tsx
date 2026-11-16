"use client";

import {
  CircleCheckIcon,
  ExternalLinkIcon,
  LinkIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { cn } from "cn";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { StatusBadge, VisibilityBadge } from "@/components/poem-badges";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { notify, UNEXPECTED_ERROR } from "@/lib/notify";
import { deletePoemAction } from "./poems/actions";
import { setPinnedPoemAction } from "./actions";

export type DashboardPoem = {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "published";
  visibility: "public" | "private";
  /** Formatted on the server, so server and client render the same text. */
  updatedLabel: string;
};

type Filter = "all" | "published" | "drafts" | "private";
const FILTERS: { value: Filter; label: string; test: (p: DashboardPoem) => boolean }[] = [
  { value: "all", label: "All", test: () => true },
  { value: "published", label: "Published", test: (p) => p.status === "published" },
  { value: "drafts", label: "Drafts", test: (p) => p.status === "draft" },
  { value: "private", label: "Private", test: (p) => p.visibility === "private" },
];

export function PoemsTable({
  poems,
  authorSlug,
  pinnedPoemId,
  justPublishedId = null,
}: {
  poems: DashboardPoem[];
  authorSlug: string;
  pinnedPoemId: string | null;
  /** The poem the editor just published (`?published=<id>`): marked, scrolled into view and focused. */
  justPublishedId?: string | null;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<DashboardPoem | null>(null);

  // Once, right after the redirect: bring the new row into view and put focus
  // on its link (whichever of the table and the phone list is showing). The
  // ref survives StrictMode and <Activity> re-shows, so it never repeats.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!justPublishedId || announced.current === justPublishedId) return;
    announced.current = justPublishedId;
    const link = [...document.querySelectorAll<HTMLElement>(`[data-just-published="${justPublishedId}"] a[href]`)].find((el) =>
      el.checkVisibility(),
    );
    if (!link) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    link.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    link.focus({ preventScroll: true });
  }, [justPublishedId]);

  const shown = useMemo(() => {
    const test = FILTERS.find((f) => f.value === filter)!.test;
    const q = query.trim().toLocaleLowerCase();
    return poems.filter((p) => test(p) && (!q || p.title.toLocaleLowerCase().includes(q)));
  }, [poems, filter, query]);

  const rowProps = { authorSlug, pinnedPoemId, onDelete: setDeleting };

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Wraps (and tightens below 360px) rather than widening the page on small phones. */}
        <div role="group" aria-label="Filter poems" className="inline-flex w-fit max-w-full flex-wrap rounded-lg bg-muted p-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className="rounded-md px-3 py-1 text-sm font-medium max-[359px]:px-2 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
            >
              {f.label}
              <span className="ml-1.5 text-xs tabular-nums">{poems.filter(f.test).length}</span>
            </button>
          ))}
        </div>
        <InputGroup className="sm:w-64">
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles"
            aria-label="Search your poems by title"
          />
        </InputGroup>
      </div>

      {shown.length === 0 ? (
        <p role="status" className="rounded-xl border border-dashed bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {query.trim() ? <>No poems match &ldquo;{query.trim()}&rdquo;.</> : "No poems here yet."}
        </p>
      ) : (
        <>
          {/* Desktop: table */}
          <div className="hidden rounded-xl border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Title</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-28">Access</TableHead>
                  <TableHead className="w-36 text-right">Last edited</TableHead>
                  <TableHead className="w-14 pr-4">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((poem) => (
                  <TableRow
                    key={poem.id}
                    data-just-published={poem.id === justPublishedId ? poem.id : undefined}
                    className={cn("relative", poem.id === justPublishedId && JUST_PUBLISHED_ROW)}
                  >
                    <TableCell className="max-w-0 pl-4 font-serif text-base">
                      {/* Stretched link: the whole row opens the editor, one tab stop. */}
                      <Link
                        href={`/admin/poems/${poem.id}`}
                        className="flex items-center gap-2 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                      >
                        <span className="truncate">{poem.title}</span>
                        {poem.id === justPublishedId && <JustPublishedBadge />}
                        {poem.id === pinnedPoemId && <PinnedBadge />}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={poem.status} />
                    </TableCell>
                    <TableCell>
                      <VisibilityBadge visibility={poem.visibility} />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">{poem.updatedLabel}</TableCell>
                    <TableCell className="relative z-10 pr-4 text-right">
                      <RowActions poem={poem} {...rowProps} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Phones: cards */}
          <ul className="grid gap-3 md:hidden">
            {shown.map((poem) => (
              <li
                key={poem.id}
                data-just-published={poem.id === justPublishedId ? poem.id : undefined}
                className={cn("relative flex items-start gap-3 rounded-xl border bg-card p-4", poem.id === justPublishedId && JUST_PUBLISHED_ROW)}
              >
                <div className="grid min-w-0 flex-1 gap-2">
                  <Link
                    href={`/admin/poems/${poem.id}`}
                    className="font-serif text-lg leading-snug after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                  >
                    {poem.title}
                    {/* Inside the link, so its name says it; the visible badge is below. */}
                    {poem.id === justPublishedId && <span className="sr-only">, just published</span>}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    {poem.id === justPublishedId && <JustPublishedBadge />}
                    <StatusBadge status={poem.status} />
                    <VisibilityBadge visibility={poem.visibility} />
                    {poem.id === pinnedPoemId && <PinnedBadge />}
                  </div>
                  <p className="text-xs text-muted-foreground">Edited {poem.updatedLabel}</p>
                </div>
                <div className="relative z-10">
                  <RowActions poem={poem} {...rowProps} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <DeleteDialog poem={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

/*
 * The just-published row: a text badge (so it never relies on colour), a
 * primary bar on its leading edge, and a tint that fades out after a few
 * seconds, but only for people who allow motion (globals.css,
 * .just-published-fade); with reduced motion the tint simply stays.
 */
const JUST_PUBLISHED_ROW = "shadow-[inset_3px_0_0_var(--primary)] just-published-fade";

function JustPublishedBadge() {
  return (
    <Badge className="shrink-0 font-sans">
      <CircleCheckIcon aria-hidden />
      Just published
    </Badge>
  );
}

function PinnedBadge() {
  return (
    <Badge variant="secondary" className="shrink-0 font-sans">
      <PinIcon aria-hidden />
      Pinned
    </Badge>
  );
}

function RowActions({
  poem,
  authorSlug,
  pinnedPoemId,
  onDelete,
}: {
  poem: DashboardPoem;
  authorSlug: string;
  pinnedPoemId: string | null;
  onDelete: (poem: DashboardPoem) => void;
}) {
  const [pending, startTransition] = useTransition();
  const published = poem.status === "published";
  const path = `/p/${authorSlug}/${poem.slug}`;
  const pinned = poem.id === pinnedPoemId;

  const togglePin = () =>
    startTransition(async () => {
      try {
        const res = await setPinnedPoemAction(pinned ? null : poem.id);
        if (res.ok) notify.success(pinned ? "Unpinned" : "Pinned to your profile", poem.title);
        else notify.error("Couldn't pin this poem", "Only published poems can be pinned.");
      } catch {
        notify.error(UNEXPECTED_ERROR.title, UNEXPECTED_ERROR.description);
      }
    });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
      notify.success("Link copied", poem.title);
    } catch {
      notify.error("Couldn't copy the link", "Your browser blocked access to the clipboard.");
    }
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${poem.title}`} disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : <MoreHorizontalIcon />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild>
          <Link href={`/admin/poems/${poem.id}`}>
            <PencilIcon />
            Edit
          </Link>
        </DropdownMenuItem>
        {published && (
          <>
            <DropdownMenuItem asChild>
              <Link href={path}>
                <ExternalLinkIcon />
                View on the board
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={copyLink}>
              <LinkIcon />
              Copy link
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={togglePin}>
              {pinned ? <PinOffIcon /> : <PinIcon />}
              {pinned ? "Unpin from profile" : "Pin to profile"}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(poem)}>
          <Trash2Icon />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeleteDialog({ poem, onClose }: { poem: DashboardPoem | null; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog open={poem !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{poem?.title}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            It will be removed from the board and can&apos;t be recovered.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              poem &&
              startTransition(async () => {
                try {
                  // Redirects to /admin?deleted=1, which shows the toast.
                  await deletePoemAction(poem.id);
                } catch (err) {
                  unstable_rethrow(err); // let redirect() through

                  notify.error(UNEXPECTED_ERROR.title, UNEXPECTED_ERROR.description);
                }
              })
            }
          >
            {pending ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
            Delete poem
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
