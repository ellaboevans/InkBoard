"use client";

import { XIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { BoardFilter } from "./board-view";

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
 * rendered (empty when unfiltered) so screen readers announce changes.
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
    <div role="status" className={cn(!name && "sr-only", className)}>
      {name && (
        <div className="flex items-center gap-1 rounded-xl border bg-background/90 py-1 pr-1 pl-3 text-sm shadow-sm backdrop-blur">
          <span>
            Showing {name} poems · <span className="tabular-nums">{total}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              filter.onChange(null);
              document.getElementById(selectId)?.focus();
            }}
          >
            <XIcon />
            Show all languages
          </Button>
        </div>
      )}
    </div>
  );
}
