import { existsSync, readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { DEV_URL, OUTBOX, PROD_URL } from "../lib/config";
import type { Recorder } from "../lib/recorder";

export type Scene = {
  id: string;
  server: "prod" | "dev";
  device: "desktop" | "phone";
  /** Database state the scene starts from (fixtures). Runs before each attempt. */
  setup?: () => void;
  run: (rec: Recorder) => Promise<void>;
};

export const urlOf = (server: Scene["server"]) => (server === "prod" ? PROD_URL : DEV_URL);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sign a fresh browser in with a fixture session token (set on the origin, as the server would). */
export async function signIn(page: Page, server: Scene["server"], token: string) {
  const base = urlOf(server);
  await page.goto(`${base}/sign-in`);
  await page.evaluate(
    ({ token, prod }) => {
      document.cookie = prod
        ? `__Host-poemhub_session=${token}; Path=/; Secure; SameSite=Lax`
        : `poemhub_session=${token}; Path=/; SameSite=Lax`;
    },
    { token, prod: server === "prod" },
  );
}

export async function openBoard(page: Page, url: string) {
  await page.goto(url);
  await page.locator('[aria-label="Poem board"][data-ready="true"]').waitFor({ state: "attached" });
  await page.evaluate(() => document.fonts.ready);
}

export const card = (page: Page, name: string) =>
  page.locator("[data-card]").filter({ has: page.getByRole("link", { name, exact: true }) }).first();

export const cardLink = (page: Page, name: string) => page.getByRole("link", { name, exact: true }).first();

const clampStep = (dx: number, dy: number, mx: number, my: number) => {
  const k = Math.min(1, mx / Math.max(1, Math.abs(dx)), my / Math.max(1, Math.abs(dy)));
  return [dx * k, dy * k] as const;
};

/** Pan the board (dragging) so `target`'s centre lands at (tx, ty), on camera. */
export async function panTo(rec: Recorder, target: Locator, tx: number, ty: number, ms = 1100) {
  for (let i = 0; i < 3; i++) {
    const box = await target.boundingBox();
    if (!box) throw new Error("panTo: target not found");
    const [dx, dy] = clampStep(tx - (box.x + box.width / 2), ty - (box.y + box.height / 2), rec.device === "phone" ? 300 : 600, rec.device === "phone" ? 600 : 300);
    if (Math.hypot(dx, dy) < 6) return;
    if (rec.device === "phone") await rec.drag(195 - dx / 2, 470 - dy / 2, dx, dy, ms);
    // Clear of the toolbar and the minimap (bottom right), which jumps the board when pressed.
    else await rec.mouseDrag(560 - dx / 2, 340 - dy / 2, dx, dy, ms);
    await sleep(250);
  }
}

/** Move the board (off camera, before a take) so `target` sits at (tx, ty). */
export async function placeBoard(page: Page, target: Locator, tx: number, ty: number) {
  for (let i = 0; i < 8; i++) {
    const box = await target.boundingBox();
    if (!box) throw new Error("placeBoard: target not found");
    const [dx, dy] = clampStep(tx - (box.x + box.width / 2), ty - (box.y + box.height / 2), 600, 300);
    if (Math.hypot(dx, dy) < 4) return;
    // Clear of the toolbar and the minimap (bottom right), which jumps the board when pressed.
    const sx = 560 - dx / 2;
    const sy = 340 - dy / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    // Real time between moves (the board computes a fling velocity from them).
    for (let k = 1; k <= 20; k++) {
      await page.mouse.move(sx + (dx * k) / 20, sy + (dy * k) / 20);
      await sleep(16);
    }
    // Hold still before letting go, so the board doesn't fling.
    await sleep(300);
    await page.mouse.up();
    await sleep(300);
  }
}

/** Board zoom level, as the zoom bar shows it. */
export async function zoomPercent(page: Page) {
  const t = await page.getByRole("button", { name: /^Zoom \d+%/ }).first().textContent();
  return Number((t ?? "").replace(/\D/g, ""));
}

/** Zoom the board (before a take, no camera) to about `target` % around (x, y). */
export async function setZoom(page: Page, target: number, x = 640, y = 400) {
  await page.mouse.move(x, y);
  for (let i = 0; i < 40; i++) {
    const z = await zoomPercent(page);
    if (Math.abs(z - target) <= 4) return;
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, z < target ? -12 : 12);
    await page.keyboard.up("Control");
    await sleep(60);
  }
}

type Mail = { to: string; kind?: string; code?: string; [k: string]: unknown };
export function outbox(): Mail[] {
  if (!existsSync(OUTBOX)) return [];
  return readFileSync(OUTBOX, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Mail);
}

/** Wait for the newest email of `kind` (sign-in codes have no kind) to `to`, sent after `since` lines. */
export async function nextMail(to: string, kind: string | undefined, since: number, timeout = 60_000): Promise<Mail> {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const found = outbox()
      .slice(since)
      .filter((m) => m.to === to && m.kind === kind)
      .pop();
    if (found) return found;
    await sleep(250);
  }
  throw new Error(`No ${kind ?? "sign-in"} email to ${to}`);
}
