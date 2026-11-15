"use client";

import { XIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { BoardFilter } from "./board-view";
import { plural } from "@/lib/plural";

/** "All languages" plus every language that has poems on the board. */
export function LanguageFilter({ id, filter, className }: { id: string; filter: BoardFilter; className?: string }) {
  if (filter.options.length === 0) return null;
  return (
    <>
      <label htmlFor={id} className="sr-only">
        Language
      </label>
      <NativeSelect
        id={id}
        size="sm"
        value={filter.active ?? ""}
        onChange={(e) => filter.onChange(e.target.value || null)}
        className={cn("rounded-lg bg-background/85 backdrop-blur", className)}
      >
        <NativeSelectOption value="">All languages</NativeSelectOption>
        {filter.options.map((o) => (
          <NativeSelectOption key={o.code} value={o.code}>
            {o.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </>
  );
}

/**
 * "Showing Ewe poems · 7" with a way back to all. The live region is always
 * rendered (empty, and out of the layout, when unfiltered) so screen readers
 * announce changes.
 *
 * One line at every width: the text never wraps (a long name truncates
 * instead), and the button never shrinks. On phones the visible text shortens
 * to "Ewe · 7" / "Show all"; the dropped words stay as sr-only text, so the
 * status and the button's name read in full.
 */
export function LanguageFilterStatus({
  filter,
  total,
  selectId,
  className,
}: {
  filter: BoardFilter;
  total: number;
  /** The LanguageFilter to focus after "Show all", since the button goes away. */
  selectId: string;
  className?: string;
}) {
  const name = filter.options.find((o) => o.code === filter.active)?.name;
  return (
    <div role="status" className={cn(name ? "flex max-w-full min-w-0" : "sr-only", className)}>
      {name && (
        <div
          data-filter-status
          className="pointer-events-auto flex max-w-full min-w-0 items-center gap-1 rounded-xl border bg-background/90 py-1 pr-1 pl-3 text-sm shadow-sm backdrop-blur"
        >
          <span data-filter-status-text className="min-w-0 truncate">
            {/* Spaces sit outside the sr-only spans: an sr-only span is a block, which drops its edge spaces. */}
            <span className="max-sm:sr-only">Showing</span> {name} <span className="max-sm:sr-only">{plural(total, "poem")}</span> ·{" "}
            <span className="tabular-nums">{total}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => {
              filter.onChange(null);
              document.getElementById(selectId)?.focus();
            }}
          >
            <XIcon />
            Show all <span className="max-sm:sr-only">languages</span>
          </Button>
        </div>
      )}
    </div>
  );
}
