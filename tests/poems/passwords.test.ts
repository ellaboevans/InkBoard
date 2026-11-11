import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/passwords";

describe("poem passwords", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("moonlight sonata");
    expect(await verifyPassword("moonlight sonata", hash)).toBe(true);
    expect(await verifyPassword("moonlight sonatA", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("salts every hash and never contains the password", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(a).not.toContain("same-password");
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
  });

  it("treats Unicode-equivalent passwords as equal", async () => {
    const hash = await hashPassword("café"); // precomposed é
    expect(await verifyPassword("café", hash)).toBe(true); // e + combining accent
  });

  it("rejects missing or malformed hashes", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$whatever")).toBe(false);
  });
});

describe("verifyPassword hardening", () => {
  it.each([
    ["empty key part", "scrypt$16384$8$1$AAAA$!!!"],
    ["empty salt and key", "scrypt$16384$8$1$$"],
    ["truncated key", "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA"],
    ["too many parts", "scrypt$16384$8$1$a$b$c"],
  ])("never accepts a malformed hash (%s)", async (_label, stored) => {
    expect(await verifyPassword("anything", stored)).toBe(false);
  });

  it("rejects unknown cost parameters without throwing", async () => {
    const real = await hashPassword("pw-123456");
    const [, , , , salt, key] = real.split("$");
    for (const params of ["1048576$8$1", "2$8$1", "16384$16$1", "16384$8$2", "x$y$z"]) {
      await expect(
        verifyPassword("pw-123456", ["scrypt", params, salt, key].join("$")),
      ).resolves.toBe(false);
    }
    // Sanity: the untampered hash still verifies.
    expect(await verifyPassword("pw-123456", real)).toBe(true);
  });

  it("rejects over-long input before hashing", async () => {
    const hash = await hashPassword("short-pass");
    expect(await verifyPassword("x".repeat(129), hash)).toBe(false);
  });
});
