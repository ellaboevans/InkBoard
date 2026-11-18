"use client";

import { useEffect, useRef, useState } from "react";
import { createResetGuard } from "@/lib/form-reset-guard";

/**
 * Keeps a controlled Radix control's state across the reset React fires
 * after every <form action> (src/lib/form-reset-guard.ts). Put `ref` on the
 * control (or any element inside the form) and wrap its change handler in
 * `ignoringReset`. Prefer the ready-made FormSwitch / FormCheckbox /
 * FormRadioGroup (src/components/form-controls.tsx).
 */
export function useFormResetGuard<T extends Element>() {
  const ref = useRef<T>(null);
  const [guard] = useState(createResetGuard);
  useEffect(() => {
    const form = ref.current?.closest("form");
    return form ? guard.listen(form) : undefined;
  }, [guard]);
  return { ref, ignoringReset: guard.ignoringReset };
}
