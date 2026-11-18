"use client";

import { BookOpenIcon, FileTextIcon, Loader2Icon, LockIcon, UserRoundIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { SearchResults } from "@/lib/search-types";
import { pluralCount } from "@/lib/plural";

const MIN = 2;
const DEBOUNCE_MS = 150;

type Fetched = { query: string; results: SearchResults } | { query: string; error: string };

/**
 * ⌘K palette over the board (R10). Searches author names, novel titles
 * (Phase 24) and poem titles on the server (/api/search); filtering is the
 * server's job, so cmdk's own filter is off.
 */
export function BoardSearch({
  open,
  onOpenChange,
  onPickAuthor,
  onPickPoem,
  onPickNovel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPickAuthor: (author: SearchResults["authors"][number]) => void;
  onPickPoem: (poem: SearchResults["poems"][number]) => void;
  onPickNovel: (novel: SearchResults["novels"][number]) => void;
}) {
  const [query, setQuery] = useState("");
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < MIN) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        const body = await res.json();
        setFetched(
          res.ok
            ? { query: trimmed, results: body as SearchResults }
            : { query: trimmed, error: body.error ?? "Search isn't available right now." },
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setFetched({ query: trimmed, error: "Search isn't available right now." });
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  // Only show results for what's currently typed (no flashes of stale ones).
  const current = fetched && fetched.query === trimmed ? fetched : null;
  const loading = trimmed.length >= MIN && !current;
  const results = current && "results" in current ? current.results : null;
  const error = current && "error" in current ? current.error : null;
  const empty = results && results.authors.length === 0 && results.novels.length === 0 && results.poems.length === 0;

  // When a result is picked the board moves focus to it; Radix must not
  // then return focus to the Search button (Enter would reopen search).
  const picked = useRef(false);
  const close = () => {
    onOpenChange(false);
    setQuery("");
  };
  const pick = (fn: () => void) => {
    picked.current = true;
    close();
    fn();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={() => (picked.current = false)}
        onCloseAutoFocus={(e) => picked.current && e.preventDefault()}
        className="top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0 max-sm:top-4 sm:max-w-lg"
      >
      <DialogHeader className="sr-only">
        <DialogTitle>Search the board</DialogTitle>
        <DialogDescription>Find an author, a novel or a poem title</DialogDescription>
      </DialogHeader>
      <Command shouldFilter={false} label="Search authors, novels and poems">
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search authors, novels and poems…"
          aria-describedby="board-search-hint"
        />
        {/* Messages sit outside the listbox: ARIA lets a listbox contain only options/groups. */}
        {trimmed.length < MIN && (
          <p id="board-search-hint" className="px-4 py-6 text-center text-sm text-muted-foreground">
            Type at least {MIN} letters. Only titles and author names are searched, never the text.
          </p>
        )}
        {loading && (
          <p role="status" className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" aria-hidden />
            Searching…
          </p>
        )}
        {error && (
          <p role="alert" className="px-4 py-6 text-center text-sm text-destructive">
            {error}
          </p>
        )}
        {empty && (
          <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">
            No authors, novels or poems match &ldquo;{trimmed}&rdquo;.
          </p>
        )}
        <CommandList className="max-h-[min(60vh,24rem)]" hidden={!results || empty ? true : undefined}>
          {results && results.authors.length > 0 && (
            <CommandGroup heading="Authors">
              {results.authors.map((a) => (
                <CommandItem
                  key={a.editorId}
                  value={`author-${a.editorId}`}
                  onSelect={() => pick(() => onPickAuthor(a))}
                >
                  <UserRoundIcon aria-hidden />
                  <span className="font-serif text-[15px]">{a.penName}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {pluralCount(a.poemCount, "poem")}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results && results.novels.length > 0 && (
            <CommandGroup heading="Novels">
              {results.novels.map((n) => (
                <CommandItem key={n.id} value={`novel-${n.id}`} onSelect={() => pick(() => onPickNovel(n))}>
                  <BookOpenIcon aria-hidden />
                  <span className="min-w-0 truncate font-serif text-[15px]">{n.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{n.penName}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results && results.poems.length > 0 && (
            <CommandGroup heading="Poems">
              {results.poems.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`poem-${p.id}`}
                  onSelect={() => pick(() => onPickPoem(p))}
                >
                  <FileTextIcon aria-hidden />
                  <span className="min-w-0 truncate font-serif text-[15px]">{p.title}</span>
                  {p.visibility === "private" && (
                    <LockIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="password protected" />
                  )}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{p.penName}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
      </DialogContent>
    </Dialog>
  );
}
