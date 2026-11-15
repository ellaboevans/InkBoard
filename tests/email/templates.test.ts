import { readFileSync } from "node:fs";
import path from "node:path";
import { EMAIL_LOGO_PNG_BASE64 } from "@/server/email-logo";
import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  formatAlertTime,
  formatNoticeTime,
  otpEmail,
  recoveryCodesChangedEmail,
  recoveryCodeUsedEmail,
  signInAlertEmail,
  signInLinkUrl,
  stepUpEmail,
} from "@/server/email-templates";

/** What a reader (or a code detector) sees in the HTML part: no tags, styles or attributes. */
function visibleText(html: string) {
  return html
    .replace(/<head[\s\S]*?<\/head>/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ");
}
const digitRuns = (s: string) => s.match(/\d{4,8}/g) ?? [];

describe("sign-in code email", () => {
  const token = "AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMnOpQr";
  const link = signInLinkUrl("https://poemhub.example", token);
  const mail = otpEmail({ code: "482910", link, appUrl: "https://poemhub.example", ttlMinutes: 10 });

  it("says how long the code lasts, singular or plural", () => {
    expect(mail.text).toContain("expire in 10 minutes and work once");
    expect(mail.html).toContain("expires in 10 minutes.");
    const short = otpEmail({ code: "482910", link, appUrl: "https://poemhub.example", ttlMinutes: 1 });
    for (const part of [short.text, short.html]) {
      expect(part).not.toContain("1 minutes");
    }
    expect(short.text).toContain("expire in 1 minute and work once");
    expect(short.html).toContain("expires in 1 minute.");
  });

  it("puts the link token in the URL fragment, never the path or query", () => {
    expect(link).toBe(`https://poemhub.example/sign-in/link#${token}`);
  });

  it("includes the sign-in link as a button and in the plain-text part", () => {
    expect(mail.html).toContain(`href="${link}"`);
    expect(mail.html).toContain("Sign in to InkBoard");
    expect(mail.text.split("\n")).toContain(link);
  });

  it("has the fixed subject, and the code in the preview text and first line", () => {
    expect(mail.subject).toBe("Your InkBoard One Time Password");
    expect(mail.text.split("\n")[0]).toBe("Your InkBoard sign-in code is:");
    expect(visibleText(mail.html).trim().startsWith("Your InkBoard sign-in code is 482910.")).toBe(true); // preheader
  });

  it("shows the code alone on its own line, bold and unbroken", () => {
    expect(mail.text.split("\n")).toContain("482910");
    expect(mail.html).toMatch(/<strong>482910<\/strong>/);
  });

  it("contains no other 4–8 digit numbers a detector could pick instead, links included", () => {
    expect(digitRuns(mail.subject)).toEqual([]);
    for (const part of [mail.text, visibleText(mail.html)]) {
      expect(new Set(digitRuns(part))).toEqual(new Set(["482910"]));
    }
    const hrefs = [...mail.html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.flatMap(digitRuns)).toEqual([]);
  });

  it("marks itself as automated; the only image is our own logo, with no tracking", () => {
    expect(mail.headers).toEqual({ "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" });
    const imgs = [...mail.html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    expect(imgs).toEqual(["cid:inkboard-logo"]);
  });

  it("the inline logo is the PNG in public/email", () => {
    const png = readFileSync(path.join(import.meta.dirname, "../../public/email/logo.png"));
    expect(Buffer.from(EMAIL_LOGO_PNG_BASE64, "base64").equals(png)).toBe(true);
  });
});

describe("new sign-in alert email", () => {
  const at = new Date("2026-11-12T21:49:00Z");
  const mail = signInAlertEmail({
    penName: "Ada <b>Verse</b>",
    device: "Chrome on macOS",
    ip: "203.0.113.5",
    at,
    appUrl: "https://poemhub.example",
    reason: "network",
  });

  it("names what was new: the device, the network, or both", () => {
    const base = { penName: null, device: "Chrome on macOS", ip: "203.0.113.5", at, appUrl: "https://poemhub.example" };
    for (const [reason, what] of [["device", "a device"], ["network", "a network"], ["both", "a device and network"]] as const) {
      const m = signInAlertEmail({ ...base, reason });
      for (const part of [m.text, visibleText(m.html)]) {
        expect(part).toContain(`signed in to from ${what} we haven't seen you use before`);
      }
    }
  });

  it("says what happened, from which device and network, and when", () => {
    expect(mail.subject).toBe("New sign-in to your InkBoard account");
    for (const part of [mail.text, visibleText(mail.html)]) {
      expect(part).toContain("Chrome on macOS");
      expect(part).toContain("203.0.113.5");
      expect(part).toContain("Thu, 12 Nov 2026 at 21:49 UTC");
    }
    expect(mail.text).toContain("https://poemhub.example/admin/profile");
    expect(mail.html).toContain('href="https://poemhub.example/admin/profile"');
  });

  it("never mentions a code, so clients don't offer to copy the date as one", () => {
    for (const part of [mail.subject, mail.text, visibleText(mail.html)]) expect(part).not.toMatch(/\bcodes?\b/i);
  });

  it("escapes editor-controlled text", () => {
    expect(mail.html).toContain("Ada &#60;b&#62;Verse&#60;/b&#62;");
    expect(mail.html).not.toContain("<b>Verse</b>");
    expect(escapeHtml(`"'&`)).toBe("&#34;&#39;&#38;");
  });

  it("formats times in UTC", () => {
    expect(formatAlertTime(new Date("2026-01-05T03:07:00Z"))).toBe("Mon, 5 Jan 2026 at 03:07 UTC");
  });
});

describe("recovery code emails", () => {
  const appUrl = "https://poemhub.example";
  // A date whose year, day and time could all form digit runs if formatted carelessly.
  const at = new Date("2026-12-31T23:59:00Z");
  const used = (remaining: number) =>
    recoveryCodeUsedEmail({ penName: "Ada <Verse>", device: "Firefox on Windows", at, remaining, appUrl });
  const changed = (firstSet: boolean) =>
    recoveryCodesChangedEmail({ penName: "Ada", device: "Safari on iPhone", at, firstSet, appUrl });
  const all = [used(9), used(1), used(0), changed(true), changed(false)];

  it("says a recovery code was used and how many are left, in the subject", () => {
    expect(used(9).subject).toBe("A recovery code was used to sign in · 9 left");
    expect(used(0).subject).toBe("A recovery code was used to sign in · none left");
    expect(used(1).text).toContain("You have 1 unused recovery code left.");
    expect(used(0).text).toContain("That was your last one");
  });

  it("names the device and time, and what to do if it wasn't them", () => {
    const mail = used(4);
    for (const part of [mail.text, visibleText(mail.html)]) {
      expect(part).toContain("Firefox on Windows");
      expect(part).toContain("Thu 31 Dec, 23:59 UTC");
      expect(part).toMatch(/Sign that device out/);
      expect(part).toMatch(/Make a new set of recovery codes/);
    }
    expect(mail.html).toContain('href="https://poemhub.example/admin/profile"');
  });

  it("contains no 4–8 digit numbers anywhere (they say 'code', so nothing may look like one)", () => {
    for (const mail of all) {
      expect(digitRuns(mail.subject)).toEqual([]);
      expect(digitRuns(mail.text)).toEqual([]);
      expect(digitRuns(visibleText(mail.html))).toEqual([]);
      const hrefs = [...mail.html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
      expect(hrefs.flatMap(digitRuns)).toEqual([]);
    }
  });

  it("formats notice times without the year", () => {
    expect(formatNoticeTime(at)).toBe("Thu 31 Dec, 23:59 UTC");
    expect(digitRuns(formatNoticeTime(new Date("2027-01-01T00:00:00Z")))).toEqual([]);
  });

  it("never includes an IP address (an IPv6 group can be four digits)", () => {
    for (const mail of all) expect(mail.text).not.toMatch(/IP address/);
  });

  it("tells a first set apart from a replacement, and never contains codes", () => {
    expect(changed(true).subject).toBe("Recovery codes were set up for your InkBoard account");
    expect(changed(false).subject).toBe("Your InkBoard recovery codes were replaced");
    expect(changed(false).text).toContain("The old codes no longer work.");
    expect(visibleText(changed(true).html)).toContain("We never send the codes themselves by email.");
    for (const mail of all) expect(mail.text).not.toMatch(/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/);
  });

  it("escapes editor-controlled text", () => {
    expect(used(3).html).toContain("Ada &#60;Verse&#62;");
    expect(used(3).html).not.toContain("<Verse>");
  });
});

describe("step-up confirmation email", () => {
  const mail = stepUpEmail({ code: "305718", appUrl: "https://poemhub.example", ttlMinutes: 10 });

  it("follows the code email rules: code first, alone on its line, unbroken", () => {
    expect(mail.text.split("\n")[0]).toBe("Your InkBoard confirmation code is:");
    expect(mail.text.split("\n")).toContain("305718");
    expect(mail.html).toMatch(/<strong>305718<\/strong>/);
    expect(visibleText(mail.html).trim().startsWith("Your InkBoard confirmation code is 305718.")).toBe(true);
  });

  it("contains no other 4–8 digit numbers, and no sign-in link", () => {
    expect(digitRuns(mail.subject)).toEqual([]);
    for (const part of [mail.text, visibleText(mail.html)]) {
      expect(new Set(digitRuns(part))).toEqual(new Set(["305718"]));
    }
    expect(mail.html).not.toContain("/sign-in/link");
    expect(mail.text).not.toContain("/sign-in/link");
  });
});
