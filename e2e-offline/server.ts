import { spawn, spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { OFFLINE_BASE_URL, OFFLINE_DATABASE_URL, OFFLINE_DIST_DIR, OFFLINE_PORT, SERVER_PID_FILE } from "./constants";

/**
 * A real production build and `next start` for the offline E2E: the service
 * worker is production-only. Builds into .next-offline so it never touches
 * your own .next or the dev E2E's .next-e2e. Each build gets its own
 * INKBOARD_BUILD_ID, so a rebuild is a new worker (the "new deploy" test).
 */
const env = (buildId: string) => ({
  ...process.env,
  NODE_ENV: "production" as const,
  DATABASE_URL: OFFLINE_DATABASE_URL,
  NEXT_DIST_DIR: OFFLINE_DIST_DIR,
  INKBOARD_BUILD_ID: buildId,
  APP_URL: OFFLINE_BASE_URL,
  // Production env validation wants these; nothing here sends email.
  RESEND_API_KEY: "re_offline_e2e_placeholder",
  AUTH_SECRET: "offline-e2e-secret-offline-e2e-secret-0123456789",
  EDITOR_ALLOWLIST: "",
  E2E_OTP_OUTBOX: "",
});

export function runFixtures() {
  const r = spawnSync("pnpm", ["exec", "tsx", "--conditions=react-server", "e2e-offline/fixtures.ts"], {
    env: env("fixtures"),
    stdio: "inherit",
  });
  if (r.status !== 0) throw new Error("offline fixtures failed");
}

export function build(buildId: string) {
  const r = spawnSync("pnpm", ["exec", "next", "build"], { env: env(buildId), stdio: "inherit" });
  if (r.status !== 0) throw new Error(`next build (${buildId}) failed`);
}

export async function start(buildId: string) {
  const child = spawn("pnpm", ["exec", "next", "start", "--port", String(OFFLINE_PORT)], {
    env: env(buildId),
    stdio: "ignore",
    detached: true, // its own process group, so stop() takes next-server down with pnpm
  });
  await writeFile(SERVER_PID_FILE, String(child.pid));
  child.unref();
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${OFFLINE_BASE_URL}/sign-in`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("next start didn't come up");
}

export async function stop() {
  const pid = Number(await readFile(SERVER_PID_FILE, "utf8").catch(() => "0"));
  if (pid) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {}
  }
  await rm(SERVER_PID_FILE, { force: true });
  // Wait until the port is free.
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`${OFFLINE_BASE_URL}/sign-in`);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
