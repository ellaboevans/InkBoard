import { readFile } from "node:fs/promises";
import { expect, type CDPSession, type Page } from "@playwright/test";
import pg from "pg";
import { E2E_DATABASE_URL, OTP_OUTBOX } from "../playwright.config";

export async function latestCode(email: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(async () => {
      const lines = (await readFile(OTP_OUTBOX, "utf8")).trim().split("\n");
      code = lines
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { to: string; kind?: string; code?: string })
        // Sign-in emails have no `kind` (step-up confirmations carry a code too).
        .findLast((m) => m.to === email && m.code && !m.kind)?.code;
      return code;
    })
    .toBeTruthy();
  return code!;
}

/** The sign-in link from the newest sign-in email to `email` (`…/sign-in/link#<token>`). */
export async function latestLink(email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(async () => {
      const lines = (await readFile(OTP_OUTBOX, "utf8")).trim().split("\n");
      link = lines
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { to: string; link?: string })
        .findLast((m) => m.to === email && m.link)?.link;
      return link;
    })
    .toBeTruthy();
  return link!;
}

export async function sql(query: string) {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await client.query(query);
  } finally {
    await client.end();
  }
}

export async function requestCode(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByRole("main").getByText(`We sent a 6-digit code to`)).toBeVisible();
}

export async function typeCode(page: Page, code: string) {
  // input-otp renders a single real <input>; typing fills all slots.
  await page.locator('input[name="code"]').fill(code);
}

/** Full sign-in + onboarding for a brand-new editor; ends on /admin. */
export async function signUpAs(page: Page, email: string, penName: string) {
  await requestCode(page, email);
  await typeCode(page, await latestCode(email));
  // The first Server Action of a run is compiled on demand by `next dev`,
  // which can take a while on a busy machine; later ones are fast.
  await expect(page).toHaveURL(/\/admin\/onboarding$/, { timeout: 45_000 });
  await page.getByRole("textbox", { name: "Pen name" }).fill(penName);
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(/\/admin(\?.*)?$/, { timeout: 45_000 });
}

/** The account menu button in the dashboard sidebar (shows the pen name). */
export const accountButton = (page: Page, penName: string) =>
  page.getByRole("button", { name: new RegExp(`^Account menu: ${penName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });

/** Sign out through the sidebar account menu. */
export async function signOut(page: Page) {
  await page.getByRole("button", { name: /^Account menu:/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
}

/** Welcome emails recorded for this address by the E2E outbox. */
export async function welcomesFor(email: string): Promise<{ penName: string; slug: string }[]> {
  const lines = (await readFile(OTP_OUTBOX, "utf8")).trim().split("\n").filter(Boolean);
  return lines
    .map((l) => JSON.parse(l) as { to: string; kind?: string; penName: string; slug: string })
    .filter((m) => m.to === email && m.kind === "welcome");
}

/** Security notices written to the E2E outbox for `email`. */
export async function alertsFor(email: string): Promise<{ device: string; ip: string }[]> {
  const lines = (await readFile(OTP_OUTBOX, "utf8")).trim().split("\n").filter(Boolean);
  return lines
    .map((l) => JSON.parse(l) as { to: string; kind?: string; device: string; ip: string })
    .filter((m) => m.to === email && m.kind === "sign-in-alert");
}

/** The toast whose title is `title` (matched on the DOM text, as written in the code). */
export const toastTitled = (page: Page, title: string) =>
  page.locator("[data-sileo-toast]").filter({ has: page.locator("[data-sileo-title]", { hasText: title }) });

/**
 * A toast's title as people see it. `innerText` applies CSS `text-transform`,
 * unlike `getByText`/`hasText` (which read the DOM text), so this is what
 * catches Sileo's default title-casing ("Saved And Published").
 */
export async function renderedToastTitle(page: Page, title: string): Promise<string> {
  const el = toastTitled(page, title).locator("[data-sileo-title]").first();
  await expect(el).toBeVisible();
  return el.evaluate((e) => (e as HTMLElement).innerText);
}

/**
 * WCAG contrast of a toast's title (and description, once it has expanded)
 * against the fill it's drawn on. Axe can't measure toasts: the fill is an SVG
 * shape behind the text, so axe files them under "incomplete", never as
 * violations. This computes the same ratio axe would.
 */
export async function toastContrast(page: Page, title: string, withDescription = true) {
  const toast = toastTitled(page, title).first();
  await expect(toast).toBeVisible();
  if (withDescription) await expect(toast.locator('[data-sileo-content][data-visible="true"]')).toBeAttached();
  return toast.evaluate((el) => {
    const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const rgba = (c: string) => {
      cv.clearRect(0, 0, 1, 1);
      cv.fillStyle = "#000";
      cv.fillStyle = c;
      cv.fillRect(0, 0, 1, 1);
      const d = cv.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const lum = (c: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const fill = el.querySelector("[data-sileo-svg] rect[fill]")?.getAttribute("fill") ?? "#FFFFFF";
    const ratio = (node: Element | null) => {
      if (!node) return null;
      const bg = rgba(fill);
      const fg = rgba(getComputedStyle(node).color);
      const mixed = fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
      const [hi, lo] = [lum(mixed), lum(bg)].sort((a, b) => b - a);
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    };
    return {
      fill,
      title: ratio(el.querySelector("[data-sileo-title]"))!,
      description: ratio(el.querySelector('[data-sileo-content][data-visible="true"] [data-sileo-description]')),
    };
  });
}

/**
 * After "Publish to board" (a new poem, or a draft's first publish): the editor
 * is back on their list, with the "Poem published" toast; the flash params
 * (`?published=…`, `&first-publish=1`) are stripped once shown.
 */
export async function expectBackOnList(page: Page, timeout = 45_000) {
  await expect(page.locator("[data-sileo-toast]").filter({ hasText: "Poem published" })).toBeVisible({ timeout });
  await expect(page).toHaveURL(/\/admin$/);
}

/** The id of the editor's poem with this title (for going back to its edit page). */
export async function poemIdByTitle(title: string): Promise<string> {
  const { rows } = await sql(`SELECT id FROM poems WHERE title = '${title.replace(/'/g, "''")}'`);
  return rows[0].id as string;
}

/** The newest step-up confirmation code emailed to `email` (profile, recovery codes). */
export async function latestStepUpCode(email: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(async () => {
      const lines = (await readFile(OTP_OUTBOX, "utf8")).trim().split("\n");
      code = lines
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { to: string; kind?: string; code?: string })
        .findLast((m) => m.to === email && m.kind === "step-up")?.code;
      return code;
    })
    .toBeTruthy();
  return code!;
}

export type RecoveryNotice =
  | { kind: "recovery-used"; device: string; remaining: number }
  | { kind: "recovery-codes-changed"; device: string; firstSet: boolean };

/** "Recovery code used" and "recovery codes changed" notices recorded for `email`. */
export async function recoveryNoticesFor(email: string): Promise<RecoveryNotice[]> {
  const lines = (await readFile(OTP_OUTBOX, "utf8")).trim().split("\n").filter(Boolean);
  return lines
    .map((l) => JSON.parse(l) as { to: string } & RecoveryNotice)
    .filter((m) => m.to === email && (m.kind === "recovery-used" || m.kind === "recovery-codes-changed"))
    .map((m) => {
      const notice: Partial<typeof m> = { ...m };
      delete notice.to;
      return notice as RecoveryNotice;
    });
}

const CODE_RE = /[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/g;

/**
 * Make recovery codes from the profile (the session must be fresh, e.g. just
 * signed up) and return them as shown. Leaves the codes on screen.
 */
export async function createRecoveryCodes(page: Page): Promise<string[]> {
  await page.goto("/admin/profile");
  await page.getByRole("button", { name: "Create recovery codes" }).click();
  return shownRecoveryCodes(page);
}

/** The codes in the "Your recovery codes" list. */
export async function shownRecoveryCodes(page: Page): Promise<string[]> {
  const list = page.getByRole("list", { name: "Recovery codes" });
  await expect(list.getByRole("listitem")).toHaveCount(10, { timeout: 45_000 });
  return (await list.innerText()).match(CODE_RE) ?? [];
}

/** Sign in at /sign-in/recovery with an email and a recovery code. */
export async function recoverySignIn(page: Page, email: string, code: string, { publicDevice = false } = {}) {
  await page.goto("/sign-in/recovery");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Recovery code" }).fill(code);
  if (publicDevice) await page.getByRole("checkbox", { name: "This isn't my device" }).check();
  await page.getByRole("button", { name: "Sign in with recovery code" }).click();
}

export type PasskeyNotice =
  | { kind: "passkey-added"; device: string; passkeyName: string; afterRecovery: boolean }
  | { kind: "passkey-removed"; device: string; passkeyName: string };

/** "Passkey added" / "passkey removed" notices recorded for `email`. */
export async function passkeyNoticesFor(email: string): Promise<PasskeyNotice[]> {
  const lines = (await readFile(OTP_OUTBOX, "utf8")).trim().split("\n").filter(Boolean);
  return lines
    .map((l) => JSON.parse(l) as { to: string } & PasskeyNotice)
    .filter((m) => m.to === email && (m.kind === "passkey-added" || m.kind === "passkey-removed"))
    .map((m) => {
      const notice: Partial<typeof m> = { ...m };
      delete notice.to;
      return notice as PasskeyNotice;
    });
}

export type VirtualCredential = {
  credentialId: string;
  isResidentCredential: boolean;
  rpId?: string;
  privateKey: string;
  userHandle?: string;
  signCount: number;
};

/**
 * A Chromium virtual authenticator on this page (CDP WebAuthn domain): a
 * platform ("internal") authenticator with resident keys and user
 * verification, answering prompts automatically. Credentials stay in it for
 * the page's life.
 */
export async function virtualAuthenticator(page: Page, { userVerified = true, autofill = false } = {}) {
  // Chrome's virtual authenticator answers the sign-in page's autofill
  // (conditional) request by itself, which a real browser only does when the
  // person picks the passkey from the email field's suggestions. Tests of the
  // button switch autofill off; the autofill test leaves it on.
  if (!autofill) {
    await page.addInitScript(() => {
      if (window.PublicKeyCredential) PublicKeyCredential.isConditionalMediationAvailable = async () => false;
    });
  }
  const cdp: CDPSession = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: userVerified,
      automaticPresenceSimulation: true,
    },
  });
  return {
    async credentials(): Promise<VirtualCredential[]> {
      return (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials as VirtualCredential[];
    },
    async addCredential(credential: VirtualCredential) {
      await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
    },
    async setUserVerified(isUserVerified: boolean) {
      await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified });
    },
  };
}
