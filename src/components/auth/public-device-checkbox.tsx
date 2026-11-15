"use client";

import { useEffect, useRef } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/**
 * "This isn't my device" on the sign-in forms (docs/PLAN.md, Phase 16).
 * Posts `publicDevice=on` when ticked: the session cookie then ends with the
 * browser, the server ends the session after 12 hours, and the browser isn't
 * remembered (src/server/auth/dal.ts).
 *
 * Controlled, and immune to form resets: React resets a `<form action>`
 * after every action, and Radix's Checkbox answers a reset by setting itself
 * back to its value at mount (through onCheckedChange), which unticked the
 * box after a failed attempt. So a change fired by a reset is ignored, and
 * the value is posted by our own hidden input (a reset doesn't touch hidden
 * inputs) rather than Radix's mirror input, which a reset leaves stale.
 */
export function PublicDeviceCheckbox({
  id = "public-device",
  checked,
  onCheckedChange,
  disabled,
}: {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const resetting = useRef(false);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    // Capture: runs before Radix's own reset listener on the same form.
    const onReset = () => {
      resetting.current = true;
      queueMicrotask(() => (resetting.current = false));
    };
    form.addEventListener("reset", onReset, { capture: true });
    return () => form.removeEventListener("reset", onReset, { capture: true });
  }, []);

  return (
    <div className="flex items-start gap-3">
      <input type="hidden" name="publicDevice" value={checked ? "on" : ""} />
      <Checkbox
        ref={ref}
        id={id}
        checked={checked}
        onCheckedChange={(v) => {
          if (!resetting.current) onCheckedChange(v === true);
        }}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        className="mt-0.5"
      />
      <div className="grid gap-1">
        <Label htmlFor={id} className="font-normal">
          This isn&apos;t my device
        </Label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          For a shared or public computer: you&apos;re signed out when the browser closes, and after 12 hours at most.
        </p>
      </div>
    </div>
  );
}
