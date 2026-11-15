import { describe, expect, it } from "vitest";
import { plural, pluralCount } from "@/lib/plural";

describe("plural", () => {
  it.each([
    [0, "poems"],
    [1, "poem"],
    [2, "poems"],
    [11, "poems"],
    [21, "poems"],
    [101, "poems"],
    [1.5, "poems"],
    [-1, "poem"],
  ])("%s → %s", (n, expected) => {
    expect(plural(n, "poem")).toBe(expected);
  });

  it("takes an explicit plural for irregular nouns", () => {
    expect(plural(1, "person", "people")).toBe("person");
    expect(plural(3, "person", "people")).toBe("people");
  });
});

describe("pluralCount", () => {
  it("prints the count and the noun", () => {
    expect(pluralCount(0, "author")).toBe("0 authors");
    expect(pluralCount(1, "author")).toBe("1 author");
    expect(pluralCount(2, "author")).toBe("2 authors");
    expect(pluralCount(1234, "poem")).toBe("1234 poems");
  });

  it("pluralises the last word of a phrase", () => {
    expect(pluralCount(1, "other device")).toBe("1 other device");
    expect(pluralCount(4, "private poem")).toBe("4 private poems");
    expect(pluralCount(1, "Ewe poem")).toBe("1 Ewe poem");
  });
});
