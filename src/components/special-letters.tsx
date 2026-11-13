"use client";

import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IPA_GROUPS, keyFace, LANGUAGE_SETS, searchIpa, TONE_MARKS, type LetterKey } from "@/lib/letter-sets";

/**
 * "Special letters" bar (docs/PLAN.md, Phase 11b): Akan, Ewe and Ga letters,
 * tone marks and IPA, inserted at the cursor of whichever of `fields` (input
 * or textarea ids) was used last. Closed until opened.
 *
 * Text goes in through the browser's editing path (insertText), like the
 * ⌘B/⌘I shortcuts: ⌘Z undoes it, maxLength holds, and React's onChange fires
 * for controlled fields. Keys cancel mousedown so the field keeps its cursor.
 */

const TAB_STORAGE_KEY = "inkboard:special-letters-tab";
const TABS = [...LANGUAGE_SETS.map((l) => l.id), "ipa"] as const;
type TabId = (typeof TABS)[number];

function Key({
  k,
  upper = false,
  face,
  className,
  onInsert,
}: {
  k: LetterKey;
  upper?: boolean;
  face?: React.ReactNode;
  className?: string;
  onInsert: (k: LetterKey, upper: boolean) => void;
}) {
  const capital = upper && !k.combining;
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onInsert(k, capital)}
      aria-label={`Insert ${capital ? "capital " : ""}${k.name}`}
      title={k.name}
      className={cn(
        "inline-flex h-10 min-w-10 items-center justify-center rounded-lg border bg-background px-2 font-serif text-xl leading-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:translate-y-px",
        className,
      )}
    >
      {face ?? (k.combining ? keyFace(k) : capital ? k.char.toUpperCase() : k.char)}
    </button>
  );
}

export function SpecialLetters({ fields, className }: { fields: string[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("akan");
  const [caps, setCaps] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const lastField = useRef(fields[0]);
  const panelId = useId();

  // Remember which field was used last, so a key types into it.
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const id = (e.target as HTMLElement | null)?.id;
      if (id && fields.includes(id)) lastField.current = id;
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, [fields]);

  function toggle() {
    if (!open) {
      try {
        const saved = localStorage.getItem(TAB_STORAGE_KEY) as TabId | null;
        if (saved && TABS.includes(saved)) setTab(saved);
      } catch {}
    }
    setOpen(!open);
  }

  function changeTab(next: string) {
    setTab(next as TabId);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {}
  }

  function insert(key: LetterKey, upper: boolean) {
    const el = document.getElementById(lastField.current) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el) return;
    el.focus();
    const start = el.selectionStart ?? el.value.length;
    const text = upper ? key.char.toUpperCase() : key.char;
    if (key.combining) {
      const before = [...el.value.slice(0, start)].pop();
      if (!before || /\s/.test(before)) {
        setStatus("Type or select a letter first, then add the mark.");
        return;
      }
    }
    if (!document.execCommand("insertText", false, text)) {
      // Fallback: set the value the way React notices, then announce it.
      const end = el.selectionEnd ?? start;
      const next = el.value.slice(0, start) + text + el.value.slice(end);
      if (el.maxLength > 0 && next.length > el.maxLength) return;
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
      setter?.call(el, next);
      el.setSelectionRange(start + text.length, start + text.length);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    setStatus(`Added ${upper ? "capital " : ""}${key.name}`);
    if (upper) setCaps(false);
  }

  const results = query ? searchIpa(query) : IPA_GROUPS;

  return (
    <div className={cn("grid gap-2", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex w-fit items-center gap-2 rounded-full border bg-card px-3 py-1 text-sm font-medium transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span aria-hidden className="font-serif text-base">
          ɛ ɔ ŋ
        </span>
        Special letters
        <ChevronDownIcon aria-hidden className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>

      <div id={panelId} hidden={!open} className="rounded-xl border bg-card">
        <Tabs value={tab} onValueChange={changeTab} className="gap-0">
          <TabsList className="m-2 h-auto flex-wrap" aria-label="Letter sets">
            {LANGUAGE_SETS.map((l) => (
              <TabsTrigger key={l.id} value={l.id}>
                {l.label}
              </TabsTrigger>
            ))}
            <TabsTrigger value="ipa">IPA</TabsTrigger>
          </TabsList>

          {LANGUAGE_SETS.map((l) => (
            <TabsContent key={l.id} value={l.id} className="grid gap-3 px-3 pb-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs tracking-wide text-muted-foreground uppercase">{l.label} letters</p>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setCaps(!caps)}
                  aria-pressed={caps}
                  className="rounded-md border px-2 py-0.5 text-xs font-medium text-muted-foreground aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
                >
                  Capitals
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {l.letters.map((k) => (
                  <Key key={k.char} k={k} upper={caps} onInsert={insert} />
                ))}
              </div>
              {l.tones && (
                <>
                  <p className="border-t pt-3 text-xs tracking-wide text-muted-foreground uppercase">
                    Tone marks · on the letter before the cursor
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {TONE_MARKS.map((t) => (
                      <Key
                        key={t.char}
                        k={t}
                        onInsert={insert}
                        className="h-12 min-w-12 flex-col gap-0.5 text-lg"
                        face={
                          <>
                            <span aria-hidden>{keyFace(t)}</span>
                            <span className="font-sans text-[10px] text-muted-foreground">{t.short}</span>
                          </>
                        }
                      />
                    ))}
                  </div>
                </>
              )}
              <p className="text-xs text-muted-foreground">
                Writing a lot? Gboard (Android, iPhone) has Akan, Ewe and Ga keyboards, and SIL Keyman covers Mac and
                Windows.
              </p>
            </TabsContent>
          ))}

          <TabsContent value="ipa" className="grid gap-3 px-3 pb-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search IPA by sound or name, e.g. “open-mid back”, “click”"
              aria-label="Search IPA symbols"
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {results.length === 0 ? (
              <p className="text-sm text-muted-foreground">No IPA symbol matches that.</p>
            ) : (
              results.map((g) => (
                <div key={g.label} className="grid gap-1.5">
                  <p className="text-xs tracking-wide text-muted-foreground uppercase">{g.label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {g.keys.map((k) => (
                      <Key key={g.label + k.char} k={k} onInsert={insert} className="h-9 min-w-9 text-lg" />
                    ))}
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
      <p aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
        {status}
      </p>
    </div>
  );
}
