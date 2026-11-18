/*
 * Radix Select (src/components/ui/select.tsx) refuses "" as an item's value:
 * "" is how it means "nothing chosen" and shows the placeholder. Our fields
 * use "" for "Not set" / "None" / "All languages" (what the forms post and
 * the server reads), so the shared wrappers (src/components/form-controls.tsx)
 * map it to one sentinel on the way in and back on the way out.
 */
export const EMPTY_SELECT_VALUE = "__none__";

/** The value Radix sees for one of ours. */
export function toSelectValue(value: string): string {
  return value === "" ? EMPTY_SELECT_VALUE : value;
}

/** Our value for the one Radix reports. */
export function fromSelectValue(value: string): string {
  return value === EMPTY_SELECT_VALUE ? "" : value;
}
