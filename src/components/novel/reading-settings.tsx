"use client";

import { cn } from "cn";
import { ALargeSmallIcon } from "lucide-react";
import { useEffect, useId, useMemo, useSyncExternalStore } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  parseReadingSettings,
  READING_FONTS,
  READING_SETTINGS_SCRIPT,
  READING_SIZES,
  READING_TEXT_KEY,
  READING_TEXT_STYLE_ID,
  readingSettingsCss,
  serializeReadingSettings,
  type ReadingSettings,
} from "@/lib/reading-settings";

/*
 * "Text settings" on chapter pages (docs/PLAN.md, Phase 26; rules in
 * src/lib/reading-settings.ts). Stored in this browser only.
 *
 * ReadingSettingsBoot is the inline script in the page's static shell that
 * applies the saved setting before the text paints. It renders the <script>
 * only into server HTML (and keeps it while hydrating, so the trees match):
 * on a client-only render React would create a raw <script>, which it warns
 * about and never runs. Those renders don't need it; the control's own state
 * (useSyncExternalStore) re-applies the <style> whenever it mounts.
 */

const listeners = new Set<() => void>();
const noopSubscribe = () => () => {};

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(READING_TEXT_KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === READING_TEXT_KEY || e.key === null) {
      applyCss(parseReadingSettings(readRaw()));
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function applyCss(s: ReadingSettings) {
  let el = document.getElementById(READING_TEXT_STYLE_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = READING_TEXT_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = readingSettingsCss(s);
}

function save(s: ReadingSettings) {
  // Shown at once even when storage is unavailable (private windows): it just isn't kept.
  applyCss(s);
  try {
    window.localStorage.setItem(READING_TEXT_KEY, serializeReadingSettings(s));
  } catch {
    // Not kept; nothing breaks.
  }
  for (const l of listeners) l();
}

export function ReadingSettingsBoot() {
  const serverHtml = useSyncExternalStore(noopSubscribe, () => false, () => true);
  return serverHtml ? <script id="inkboard-reading-text-boot" dangerouslySetInnerHTML={{ __html: READING_SETTINGS_SCRIPT }} /> : null;
}

/** The "Text settings" button in the chapter's sticky bar, and its popover. */
export function ReadingSettingsControl() {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const settings = useMemo(() => parseReadingSettings(raw), [raw]);
  const id = useId();
  // A client-only render had no boot script: apply the saved setting now (idempotent otherwise).
  useEffect(() => applyCss(settings), [settings]);

  return (
    <Popover>
      <PopoverTrigger
        data-reading-settings
        aria-label="Text settings"
        className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ALargeSmallIcon className="size-5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] font-sans" aria-label="Text settings">
        <Group
          legend="Text size"
          name={`${id}-size`}
          options={READING_SIZES}
          value={settings.size}
          onChange={(size) => save({ ...settings, size })}
          sample={(o) => ({ fontSize: `${0.5 + 0.5 * o.scale}rem` })}
          columns={4}
        />
        <Group
          legend="Font"
          name={`${id}-font`}
          options={READING_FONTS}
          value={settings.font}
          onChange={(font) => save({ ...settings, font })}
          sample={(o) => ({ fontFamily: o.id === "sans" ? "var(--font-sans)" : "var(--font-serif)" })}
          columns={2}
          className="mt-4"
        />
      </PopoverContent>
    </Popover>
  );
}

function Group<T extends { id: string; label: string }>({
  legend,
  name,
  options,
  value,
  onChange,
  sample,
  columns,
  className,
}: {
  legend: string;
  name: string;
  options: readonly T[];
  value: T["id"];
  onChange: (v: T["id"]) => void;
  sample: (o: T) => React.CSSProperties;
  columns: number;
  className?: string;
}) {
  return (
    <fieldset className={className}>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <label
            key={o.id}
            className={cn(
              "relative flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-1 text-center text-[13px] leading-tight",
              "has-[:checked]:border-primary has-[:checked]:bg-primary/8 has-[:checked]:font-medium",
              "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.id}
              checked={value === o.id}
              onChange={() => onChange(o.id)}
              className="sr-only"
            />
            <span style={sample(o)}>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
