/**
 * Shared settings for the video tooling. Every path is under video/.out
 * (gitignored); every server and database is dedicated to this worktree.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const ROOT = process.cwd();
if (!existsSync(path.join(ROOT, "package.json")) || !readFileSync(path.join(ROOT, "package.json"), "utf8").includes('"name": "poemhub"')) {
  throw new Error("Run the video tooling from the repository root (pnpm video …)");
}

export const OUT = path.join(ROOT, "video/.out");
export const TAKES = path.join(OUT, "takes");
export const RENDERS = path.join(OUT, "renders");
export const OVERLAYS = path.join(OUT, "overlays");
export const OUTBOX = path.join(OUT, "outbox.jsonl");

/** This worktree's name ("elm"), used to name its own database. */
export const WORKTREE = path.basename(ROOT).toLowerCase().replace(/[^a-z0-9]+/g, "_");
export const DATABASE_URL =
  process.env.VIDEO_DATABASE_URL ?? `postgresql://localhost:5432/poemhub_video_${WORKTREE}`;

export const PROD_PORT = Number(process.env.VIDEO_PROD_PORT ?? 3247);
export const DEV_PORT = Number(process.env.VIDEO_DEV_PORT ?? 3248);
for (const port of [PROD_PORT, DEV_PORT]) {
  // 3000 and 3010 belong to the main checkout's servers.
  if (port === 3000 || port === 3010) throw new Error(`Port ${port} is reserved; pick another VIDEO_*_PORT`);
}
export const PROD_URL = `http://localhost:${PROD_PORT}`;
export const DEV_URL = `http://localhost:${DEV_PORT}`;

/** The live site. Shown in the browser frame and used as APP_URL by the production build. */
export const LIVE_HOST = "tryinkboard.elabo.me";
export const LIVE_ORIGIN = `https://${LIVE_HOST}`;

/** Recording-only secrets: the video database is throwaway. */
export const AUTH_SECRET = "inkboard-video-recording-only-secret-0123456789";

export const NODE22 = process.versions.node.split(".").map(Number)[0] >= 22;
