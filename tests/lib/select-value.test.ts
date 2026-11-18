import { describe, expect, it } from "vitest";
import { EMPTY_SELECT_VALUE, fromSelectValue, toSelectValue } from "@/lib/select-value";

describe("select values", () => {
  it("maps the empty choice to a sentinel Radix accepts, and back", () => {
    expect(toSelectValue("")).toBe(EMPTY_SELECT_VALUE);
    expect(fromSelectValue(EMPTY_SELECT_VALUE)).toBe("");
    expect(EMPTY_SELECT_VALUE).not.toBe("");
  });
  it.each(["ee", "ak", "0b9e3a1c-1111-4222-8333-444455556666", "3", "ongoing"])("leaves %j alone both ways", (v) => {
    expect(toSelectValue(v)).toBe(v);
    expect(fromSelectValue(toSelectValue(v))).toBe(v);
  });
});
