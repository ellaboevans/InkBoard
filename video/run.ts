/**
 * pnpm video [command] — re-record and re-render the InkBoard walkthroughs.
 * See video/README.md.
 *
 *   pnpm video                 everything: prepare, record, render, finish, check
 *   pnpm video prepare         fresh video database (seed + demo content), production build
 *   pnpm video record [ids…]   record takes (all, or the given scene ids, in order)
 *   pnpm video render <walkthrough|reel> [part…]   render parts of a video
 *   pnpm video finish          join parts, add the silent audio track, captions, script, covers
 *   pnpm video check           ffprobe both videos and make contact sheets
 *   pnpm video stop            stop any server the tooling started
 *   pnpm video list            list scenes and parts
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATABASE_URL, NODE22, OUT, OUTBOX } from "./lib/config";
import { fixture } from "./lib/fixtures";
import { closeBrowser, Recorder } from "./lib/recorder";
import { buildProd, startDev, startProd, stopAll, warmDev } from "./lib/servers";
import { SCENES } from "./scenes";
import { check } from "./render/check";
import { finish } from "./render/finish";
import { PARTS, renderVideo, type VideoName } from "./render/videos";

async function prepare() {
  await stopAll();
  const db = new URL(DATABASE_URL).pathname.slice(1);
  const exists = spawnSync("psql", ["-Atc", `SELECT 1 FROM pg_database WHERE datname='${db}'`, "postgres"], { encoding: "utf8" });
  if (!exists.stdout.includes("1")) {
    console.log(`▸ createdb ${db}`);
    if (spawnSync("createdb", [db], { stdio: "inherit" }).status !== 0) throw new Error("createdb failed");
  }
  console.log("▸ migrations");
  const m = spawnSync("pnpm", ["db:migrate"], { env: { ...process.env, DATABASE_URL }, stdio: "inherit" });
  if (m.status !== 0) throw new Error("migrations failed");
  console.log("▸ demo content");
  fixture("reset");
  mkdirSync(OUT, { recursive: true });
  writeFileSync(OUTBOX, ""); // the E2E outbox the dev server writes emails to
  buildProd();
}

async function record(ids: string[]) {
  const scenes = ids.length ? ids.map((id) => {
    const s = SCENES.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown scene ${id}`);
    return s;
  }) : SCENES;
  mkdirSync(OUT, { recursive: true });
  const needDev = scenes.some((s) => s.server === "dev");
  const needProd = scenes.some((s) => s.server === "prod");
  try {
    if (needProd) await startProd();
    if (needDev) {
      if (!existsSync(OUTBOX)) writeFileSync(OUTBOX, "");
      await startDev();
      await warmDev();
    }
    for (const scene of scenes) {
      console.log(`▸ ${scene.id} (${scene.server}, ${scene.device})`);
      fixture("rate-limits:clear");
      if (scene.server === "dev") {
        // `next dev` compiles each Server Action on first use: rehearse once, unrecorded.
        scene.setup?.();
        const dry = new Recorder(`_rehearsal-${scene.id}`, scene.device);
        await scene.run(dry).catch((e) => console.log(`  (rehearsal: ${String(e).split("\n")[0]})`));
        await Promise.all(dry.contexts.map((c) => c.close().catch(() => {})));
        rmSync(dry.dir, { recursive: true, force: true });
        fixture("rate-limits:clear");
      }
      scene.setup?.();
      let lastError: unknown;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const rec = new Recorder(scene.id, scene.device);
        try {
          await scene.run(rec);
          lastError = undefined;
          break;
        } catch (e) {
          lastError = e;
          mkdirSync(path.join(OUT, "failures"), { recursive: true });
          try {
            await rec.p.screenshot({ path: path.join(OUT, "failures", `${scene.id}-${attempt}.png`) });
          } catch {}
          console.log(`  ✗ attempt ${attempt}: ${String(e).split("\n").slice(0, 3).join(" | ")}`);
          await Promise.all(rec.contexts.map((c) => c.close().catch(() => {})));
          scene.setup?.();
          fixture("rate-limits:clear");
        }
      }
      if (lastError) throw lastError;
    }
  } finally {
    await closeBrowser();
    await stopAll();
  }
}

async function main() {
  if (!NODE22) throw new Error("Use Node 22+ (see .nvmrc)");
  const [command = "all", ...args] = process.argv.slice(2);
  const t0 = Date.now();
  try {
    switch (command) {
      case "prepare":
        await prepare();
        break;
      case "record":
        await record(args);
        break;
      case "render":
        await renderVideo(args[0] as VideoName, args.slice(1).map(Number));
        break;
      case "finish":
        await finish();
        break;
      case "check":
        await check();
        break;
      case "stop":
        await stopAll();
        break;
      case "list":
        console.log("scenes:", SCENES.map((s) => s.id).join(" "));
        for (const [name, parts] of Object.entries(PARTS)) console.log(`${name} parts: ${parts.length}`);
        break;
      case "all":
        await prepare();
        await record([]);
        await renderVideo("walkthrough", []);
        await renderVideo("reel", []);
        await finish();
        await check();
        break;
      default:
        throw new Error(`Unknown command ${command}`);
    }
  } finally {
    await closeBrowser();
    await stopAll();
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
