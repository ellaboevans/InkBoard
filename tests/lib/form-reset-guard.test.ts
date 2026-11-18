import { describe, expect, it, vi } from "vitest";
import { createResetGuard } from "@/lib/form-reset-guard";

/*
 * The guard behind FormSwitch / FormCheckbox / FormRadioGroup
 * (src/components/form-controls.tsx): Radix answers a form's `reset` by
 * calling onCheckedChange / onValueChange with its value at mount; that call
 * must be dropped, and every other change must go through. In the browser the
 * guard's capture listener runs before Radix's own listener on the form; a
 * plain EventTarget has no phases, so here it's simply registered first (the
 * E2E tests cover the real order).
 */

/** A "form" whose reset makes a Radix-like control report its value at mount. */
function formWithControl(onChange: (v: boolean) => void, guard = createResetGuard()) {
  const form = new EventTarget();
  const unlisten = guard.listen(form);
  const handler = guard.ignoringReset(onChange);
  form.addEventListener("reset", () => handler(false));
  return { form, handler, unlisten, reset: () => form.dispatchEvent(new Event("reset")) };
}

describe("createResetGuard", () => {
  it("drops the change a reset fires, and passes the user's changes before and after it", async () => {
    const onChange = vi.fn();
    const { handler, reset } = formWithControl(onChange);
    handler(true);
    reset();
    expect(onChange.mock.calls).toEqual([[true]]);
    await Promise.resolve(); // the reset is over
    handler(false);
    handler(true);
    expect(onChange.mock.calls).toEqual([[true], [false], [true]]);
  });

  it("drops it after every reset, not only the first (a form saved twice)", async () => {
    const onChange = vi.fn();
    const { reset } = formWithControl(onChange);
    for (let i = 0; i < 3; i++) {
      reset();
      await Promise.resolve();
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stops watching once cleaned up (the control unmounted)", () => {
    const onChange = vi.fn();
    const { reset, unlisten } = formWithControl(onChange);
    unlisten();
    reset();
    expect(onChange.mock.calls).toEqual([[false]]);
  });

  it("passes every argument through, and tolerates a missing handler", () => {
    const guard = createResetGuard();
    const onValue = vi.fn();
    guard.ignoringReset(onValue)("shared", 2);
    expect(onValue).toHaveBeenCalledWith("shared", 2);
    expect(() => guard.ignoringReset(undefined)("x")).not.toThrow();
  });

  it("guards are independent: one form's reset doesn't silence another form's control", () => {
    const a = vi.fn();
    const b = vi.fn();
    const first = formWithControl(a);
    const second = formWithControl(b);
    first.reset();
    second.handler(true);
    expect(a).not.toHaveBeenCalled();
    expect(b.mock.calls).toEqual([[true]]);
  });
});
