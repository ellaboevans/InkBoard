"use client";

import type { ComponentProps } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { useFormResetGuard } from "@/hooks/use-form-reset-guard";

/*
 * Radix controls for use inside a <form action> (CLAUDE.md, "Client
 * patterns"). Controlled only, and immune to the reset React fires after
 * every action (src/lib/form-reset-guard.ts), which otherwise sets a Radix
 * control back to its value at mount. They take no `name`: Radix's own mirror
 * input is what a reset leaves stale, so post the value with your own
 * <input type="hidden"> next to the control.
 */

type Controlled<P, K extends keyof P> = Omit<P, "name" | "ref" | "defaultChecked" | "defaultValue" | K> & Required<Pick<P, K>>;

export function FormSwitch({
  onCheckedChange,
  ...props
}: Controlled<ComponentProps<typeof Switch>, "checked" | "onCheckedChange">) {
  const { ref, ignoringReset } = useFormResetGuard<HTMLButtonElement>();
  return <Switch ref={ref} {...props} onCheckedChange={ignoringReset(onCheckedChange)} />;
}

export function FormCheckbox({
  onCheckedChange,
  ...props
}: Controlled<ComponentProps<typeof Checkbox>, "checked" | "onCheckedChange">) {
  const { ref, ignoringReset } = useFormResetGuard<HTMLButtonElement>();
  return <Checkbox ref={ref} {...props} onCheckedChange={ignoringReset(onCheckedChange)} />;
}

export function FormRadioGroup({
  onValueChange,
  ...props
}: Controlled<ComponentProps<typeof RadioGroup>, "value" | "onValueChange">) {
  const { ref, ignoringReset } = useFormResetGuard<HTMLDivElement>();
  return <RadioGroup ref={ref} {...props} onValueChange={ignoringReset(onValueChange)} />;
}
