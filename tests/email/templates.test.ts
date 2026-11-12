import { describe, expect, it } from "vitest";
import { escapeHtml, formatAlertTime, otpEmail, signInAlertEmail } from "@/server/email-templates";

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
  const mail = otpEmail({ code: "482910", appUrl: "https://poemhub.example", ttlMinutes: 10 });

  it("puts 'code' and the code in the subject and first line", () => {
    expect(mail.subject).toBe("482910 is your PoemHub sign-in code");
    expect(mail.text.split("\n")[0]).toBe("Your PoemHub sign-in code is:");
    expect(visibleText(mail.html).trim().startsWith("Your PoemHub sign-in code is 482910.")).toBe(true); // preheader
  });

  it("shows the code alone on its own line, bold and unbroken", () => {
    expect(mail.text.split("\n")).toContain("482910");
    expect(mail.html).toMatch(/<strong>482910<\/strong>/);
  });

  it("contains no other 4–8 digit numbers a detector could pick instead", () => {
    for (const part of [mail.subject, mail.text, visibleText(mail.html)]) {
      expect(new Set(digitRuns(part))).toEqual(new Set(["482910"]));
    }
  });

  it("marks itself as automated and has no tracking or unsubscribe header", () => {
    expect(mail.headers).toEqual({ "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" });
    expect(mail.html).not.toMatch(/<img/);
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
  });

  it("says what happened, from which device and network, and when", () => {
    expect(mail.subject).toBe("New sign-in to your PoemHub account");
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
