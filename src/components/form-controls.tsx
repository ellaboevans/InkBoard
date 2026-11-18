"use client";

import type { ComponentProps, ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFormResetGuard } from "@/hooks/use-form-reset-guard";
import { fromSelectValue, toSelectValue } from "@/lib/select-value";

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

export type SelectOption = {
  /** "" is allowed (Not set / None): mapped for Radix by src/lib/select-value.ts. */
  value: string;
  label: ReactNode;
  disabled?: boolean;
  /** For an option holding a poem's or novel's own text; kept on the value shown in the trigger too. */
  lang?: string;
};

type SelectControlProps = {
  /** The trigger's id: point the field's <Label htmlFor> at it. */
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  disabled?: boolean;
  size?: "sm" | "default";
  className?: string;
  contentClassName?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
};

function SelectBody({
  id,
  value,
  onValueChange,
  options,
  disabled,
  size,
  className,
  contentClassName,
  triggerRef,
  ...aria
}: SelectControlProps & { triggerRef?: React.Ref<HTMLButtonElement> }) {
  return (
    <Select value={toSelectValue(value)} onValueChange={(v) => onValueChange(fromSelectValue(v))} disabled={disabled}>
      <SelectTrigger ref={triggerRef} id={id} size={size} className={className} {...aria}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        {options.map((o) => (
          <SelectItem key={o.value} value={toSelectValue(o.value)} disabled={o.disabled}>
            {o.lang ? <span lang={o.lang}>{o.label}</span> : o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The one dropdown (shadcn/Radix Select) outside a <form action>: the board's
 * language filter, the passage sheet's trims, "Add a poem". No native
 * <select> anywhere (CLAUDE.md, "Client patterns").
 */
export function SelectControl(props: SelectControlProps) {
  return <SelectBody {...props} />;
}

/**
 * The dropdown inside a <form action>: like FormSwitch, controlled only and
 * immune to the reset React fires after every action (Radix's Select also sets
 * itself back to its value at mount then). Takes no `name`: post the value with
 * your own <input type="hidden"> beside it.
 */
export function FormSelect({ onValueChange, ...props }: SelectControlProps) {
  const { ref, ignoringReset } = useFormResetGuard<HTMLButtonElement>();
  return <SelectBody {...props} triggerRef={ref} onValueChange={ignoringReset(onValueChange)} />;
}
