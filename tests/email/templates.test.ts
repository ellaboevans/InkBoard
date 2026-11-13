import { readFileSync } from "node:fs";
import path from "node:path";
import { EMAIL_LOGO_PNG_BASE64 } from "@/server/email-logo";
import { describe, expect, it } from "vitest";
import { escapeHtml, formatAlertTime, otpEmail, signInAlertEmail, signInLinkUrl } from "@/server/email-templates";

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
