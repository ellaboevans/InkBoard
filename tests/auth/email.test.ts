import { describe, expect, it } from "vitest";
import { isEmailAllowed, normalizeEmail } from "@/server/auth/email";

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });
  it.each(["", "nope", "a@", "@b.com", 42, null, undefined])(
    "rejects %p",
    (v) => expect(normalizeEmail(v)).toBeNull(),
  );
});

describe("isEmailAllowed", () => {
  it("allows everyone when the allowlist is empty", () => {
    expect(isEmailAllowed("x@y.com", "")).toBe(true);
    expect(isEmailAllowed("x@y.com", " , ")).toBe(true);
  });
  it("matches exact emails and @domains", () => {
    const list = "ada@example.com, @poets.org";
    expect(isEmailAllowed("ada@example.com", list)).toBe(true);
    expect(isEmailAllowed("bob@poets.org", list)).toBe(true);
    expect(isEmailAllowed("bob@example.com", list)).toBe(false);
  });
  it("does not match look-alike domains", () => {
    expect(isEmailAllowed("eve@evilpoets.org", "@poets.org")).toBe(false);
    expect(isEmailAllowed("eve@poets.org.evil.com", "@poets.org")).toBe(false);
  });
});

import { clientIpFromForwardedFor } from "@/server/auth/ip";

describe("clientIpFromForwardedFor", () => {
  it("ignores client-supplied entries to the left of trusted hops", () => {
    // Attacker sends "X-Forwarded-For: 1.1.1.1"; our proxy appends the real peer.
    expect(clientIpFromForwardedFor("1.1.1.1, 203.0.113.5", 1)).toBe("203.0.113.5");
    expect(clientIpFromForwardedFor("1.1.1.1, 203.0.113.5, 10.0.0.2", 2)).toBe("203.0.113.5");
  });
  it("handles single entries, blanks and too-few hops", () => {
    expect(clientIpFromForwardedFor("203.0.113.5")).toBe("203.0.113.5");
    expect(clientIpFromForwardedFor("203.0.113.5", 3)).toBe("203.0.113.5");
    expect(clientIpFromForwardedFor("")).toBeNull();
    expect(clientIpFromForwardedFor(" , ")).toBeNull();
    expect(clientIpFromForwardedFor(null)).toBeNull();
  });
});

import { ipBucket } from "@/server/auth/ip";

describe("ipBucket", () => {
  it("groups IPv6 addresses by /64, however they're written", () => {
    const a = ipBucket("2001:db8:abcd:12:1111:2222:3333:4444");
    expect(a).toBe("2001:db8:abcd:12::/64");
    expect(ipBucket("2001:0db8:abcd:0012::1")).toBe(a);
    expect(ipBucket("[2001:db8:abcd:12::ffff]")).toBe(a);
    expect(ipBucket("2001:DB8:ABCD:12:9::")).toBe(a);
    expect(ipBucket("2001:db8:abcd:13::1")).not.toBe(a);
    expect(ipBucket("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(ipBucket("::1")).toBe("0:0:0:0::/64");
  });
  it("keeps IPv4 per address, including IPv4-mapped IPv6", () => {
    expect(ipBucket("203.0.113.5")).toBe("203.0.113.5");
    expect(ipBucket("::ffff:203.0.113.5")).toBe("203.0.113.5");
  });
  it("buckets missing IPs together", () => {
    expect(ipBucket(null)).toBe("unknown");
    expect(ipBucket("")).toBe("unknown");
  });
});
