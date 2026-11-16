/**
 * The two app servers the recordings use, both on the worktree's own video
 * database:
 *
 * - prod: a production build (`next build` + `next start`). Reader scenes,
 *   offline reading, install, and every writer scene that sends no email.
 *   APP_URL is the live site, so absolute URLs on screen (feed links, the
 *   export file) are the real ones. The Resend key is a placeholder: nothing
 *   recorded on this server sends email.
 * - dev: `next dev` with the E2E outbox and no Resend key, for the scenes that
 *   send email (sign-in codes, recovery codes, passkeys, account deletion).
 *   Emails are appended to video/.out/outbox.jsonl, never sent. Its dev
 *   indicator is hidden by the recorder (see recorder.ts).
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { AUTH_SECRET, ROOT, DATABASE_URL, DEV_PORT, DEV_URL, LIVE_ORIGIN, OUT, OUTBOX, PROD_PORT, PROD_URL } from "./config";

const PROD_DIST = "video/.out/next-prod";
const DEV_DIST = "video/.out/next-dev";
const BUILD_ID_FILE = path.join(OUT, "build-id");

function baseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Never inherit anything that could reach a real inbox or another database.
  for (const key of Object.keys(env)) {
    if (/^(RESEND_|EMAIL_|E2E_|DATABASE_URL|APP_URL|AUTH_SECRET|EDITOR_ALLOWLIST|CRON_SECRET|NEXT_DIST_DIR)/.test(key)) delete env[key];
  }
  return {
    ...env,
    DATABASE_URL,
    AUTH_SECRET,
    EDITOR_ALLOWLIST: "",
    CRON_SECRET: "",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

export function prodEnv(): NodeJS.ProcessEnv {
  const buildId = existsSync(BUILD_ID_FILE) ? readFileSync(BUILD_ID_FILE, "utf8").trim() : "video";
  return {
    ...baseEnv(),
    NODE_ENV: "production",
    NEXT_DIST_DIR: PROD_DIST,
    INKBOARD_BUILD_ID: buildId,
    APP_URL: LIVE_ORIGIN,
    // Production env validation wants a key; this one is not a real key and
    // nothing recorded on this server sends email.
    RESEND_API_KEY: "re_video_placeholder_never_sends",
    E2E_OTP_OUTBOX: "",
  };
}

export function devEnv(): NodeJS.ProcessEnv {
  return {
    ...baseEnv(),
    NODE_ENV: "development",
    NEXT_DIST_DIR: DEV_DIST,
    // Passkeys accept exactly this origin.
    APP_URL: DEV_URL,
    // No key + an outbox: the E2E delivery path, which writes emails to a file.
    RESEND_API_KEY: "",
    E2E_OTP_OUTBOX: OUTBOX,
  };
}

/** Env for the fixtures script: the production server's (no email is sent there). */
export const fixturesEnv = prodEnv;

export function buildProd() {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(BUILD_ID_FILE, `video-${Date.now().toString(36)}`);
  console.log("▸ next build (production, video database)…");
  const r = spawnSync("pnpm", ["exec", "next", "build"], { env: prodEnv(), stdio: "inherit" });
  if (r.status !== 0) throw new Error("next build failed");
}

type Server = { name: string; url: string; pidFile: string };
const PROD: Server = { name: "prod", url: PROD_URL, pidFile: path.join(OUT, "prod.pid") };
const DEV: Server = { name: "dev", url: DEV_URL, pidFile: path.join(OUT, "dev.pid") };

async function up(url: string) {
  try {
    const r = await fetch(`${url}/sign-in`, { signal: AbortSignal.timeout(60_000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function start(server: Server, args: string[], env: NodeJS.ProcessEnv) {
  // Clear what a crashed run of ours left there; anything else on the port is an error.
  if (listenerGroups(server.url).length) await stop(server);
  if (await up(server.url)) throw new Error(`Port of ${server.url} is taken by another program; set VIDEO_PROD_PORT / VIDEO_DEV_PORT`);
  mkdirSync(OUT, { recursive: true });
  const child = spawn("pnpm", ["exec", "next", ...args], {
    env,
    stdio: ["ignore", "ignore", "inherit"],
    detached: true, // own process group, so stop() takes next-server down with pnpm
  });
  writeFileSync(server.pidFile, String(child.pid));
  child.unref();
  for (let i = 0; i < 240; i++) {
    if (await up(server.url)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${server.name} server didn't come up on ${server.url}`);
}

/**
 * Process groups of *this worktree's* servers listening on the port
 * (next-server runs in a group of its own). A process started from another
 * checkout is never touched, even on the same port.
 */
function listenerGroups(url: string): number[] {
  const port = new URL(url).port;
  const pids = spawnSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  return pids
    .filter((pid) => {
      const cwd = spawnSync("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"], { encoding: "utf8" }).stdout.split("\n").find((l) => l.startsWith("n"));
      return cwd?.slice(1) === ROOT;
    })
    .map((pid) => Number(spawnSync("ps", ["-o", "pgid=", "-p", pid], { encoding: "utf8" }).stdout.trim()))
    .filter((g) => g > 1);
}

async function stop(server: Server) {
  const pid = existsSync(server.pidFile) ? Number(readFileSync(server.pidFile, "utf8")) : 0;
  const groups = new Set([...(pid ? [pid] : []), ...listenerGroups(server.url)]);
  const kill = (signal: NodeJS.Signals) => {
    for (const g of [...groups, ...listenerGroups(server.url)]) {
      try {
        process.kill(-g, signal);
      } catch {}
    }
  };
  kill("SIGTERM");
  rmSync(server.pidFile, { force: true });
  // Wait until nothing listens on the port (graceful shutdown), then force it.
  for (let i = 0; i < 40 && listenerGroups(server.url).length; i++) await new Promise((r) => setTimeout(r, 250));
  for (let i = 0; i < 40 && listenerGroups(server.url).length; i++) {
    kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 250));
  }
  if (listenerGroups(server.url).length) throw new Error(`Could not stop the ${server.name} server on ${server.url}`);
}

export const startProd = () => start(PROD, ["start", "--port", String(PROD_PORT)], prodEnv());
export const startDev = () => start(DEV, ["dev", "--port", String(DEV_PORT)], devEnv());
export const stopProd = () => stop(PROD);
export const stopDev = () => stop(DEV);
export const stopAll = () => Promise.all([stopProd(), stopDev()]);

/**
 * `next dev` compiles each route on first request. Request every route the
 * dev scenes use once, before recording (the intercepted overlay too).
 */
export async function warmDev() {
  const routes = [
    "/sign-in",
    "/sign-in/recovery",
    "/sign-in/link",
    "/",
    "/admin",
    "/admin/onboarding",
    "/admin/profile",
    "/admin/settings",
    "/admin/poems/new",
    "/avatars/a01",
    "/sw.js",
  ];
  await Promise.all(
    routes.map((r) => fetch(DEV_URL + r, { redirect: "manual", signal: AbortSignal.timeout(180_000) }).catch(() => {})),
  );
  await fetch(DEV_URL + "/sign-in/passkey/options", { method: "POST", signal: AbortSignal.timeout(180_000) }).catch(() => {});
}
