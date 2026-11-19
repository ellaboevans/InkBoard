# InkBoard videos (reels-studio)

Two Remotion compositions: the launch Reel (`LaunchReel`) and the "What's new in InkBoard" walkthrough (`WhatsNew`, below).

## The launch Reel

A 35-second vertical Reel (1080×1920, 60 fps) made from real captures of the app, with the
motion, captions and stage done in Remotion. Lives beside the app and changes nothing in it.

Deliverables: `out/platform-launch-reel.mp4` (not in git; a copy is in `~/Movies/InkBoard-video/reel/`), `out/CREDITS.txt` (post the music credit with every upload).

Agent skills used to build it (screencli, demo-director, Remotion's) are not committed: reinstall them
from inside this folder with `npx skills add <source>` for each source in `skills-lock.json`.

## Pipeline

1. **Data** (from the worktree root, on the reel's own database `poemhub_dev_elm_reel`, local
   photo storage in `reels-studio/tmp/storage`, emails to an outbox file, never sent):
   `pnpm db:migrate`, `pnpm db:seed`, then
   `pnpm exec tsx --conditions=react-server reels-studio/scripts/seed-novels.ts` and
   `… reels-studio/scripts/reel-fixtures.ts setup` / `sessions` (fixture sessions: no email).
   Env: `DATABASE_URL`, `PHOTO_STORAGE_DIR=reels-studio/tmp/storage`, `E2E_OTP_OUTBOX=…/tmp/outbox.jsonl`, no `R2_*`, no `RESEND_API_KEY`.
2. **App**: `next dev -p 3263` with `NEXT_DIST_DIR=reels-studio/tmp/next-reel` and
   `APP_URL=https://tryinkboard.elabo.me` (so printed `/s/` links are the real ones).
   `next dev` rewrites the root `tsconfig.json` and `next-env.d.ts`; restore both afterwards.
3. **Captures**: `node scripts/capture.ts [section …]` (Node 22): 390×844 at 3× in the installed
   Chrome, dev badge and scrollbars hidden; element boxes in `captures/boxes.json`. Copy to `public/captures/`.
4. **Voice**: `~/Movies/InkBoard-video/tts/venv/bin/python -I scripts/voice.py src/data/script.json tmp/voice`
   (Kokoro, `af_heart`), then word timings with Whisper:
   `tmp/whisper-venv/bin/python -I scripts/align.py src/data/script.json tmp/voice src/data/voice-timing.json`
   (venv: `python3 -m venv tmp/whisper-venv && tmp/whisper-venv/bin/pip install faster-whisper==1.2.1`).
   Line start times: `src/data/placement.json`.
5. **Soundtrack**: `python3 -I scripts/mix.py` → `tmp/soundtrack.wav` (voice at -16 LUFS, "Inspired"
   at -30 LUFS ducked under it with mixmusic.py's sidechain settings).
6. **Video**: `npx remotion render src/index.ts LaunchReel tmp/reel-video.mp4 --codec=h264 --crf=17 --pixel-format=yuv420p --concurrency=2 --muted --jpeg-quality=95`,
   then `ffmpeg -i tmp/reel-video.mp4 -i tmp/soundtrack.wav -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest out/platform-launch-reel.mp4`.
   Preview stills: `node scripts/stills.mjs 1.2 6.5 …` → `tmp/stills/`.

Source: `src/scenes/Scenes.tsx` (the beats), `src/components/Phone.tsx` (phone card, in-phone
transitions, camera, taps), `src/components/Stage.tsx` (paper/blueprint stage, sweep, corner
labels, tags, captions). Every camera move is `spring({ damping: 14, stiffness: 180 })`.

## What's new in InkBoard (walkthrough)

A 2:53 narrated tour (1920×1080, 30 fps) of everything added since the 6-minute walkthrough:
share as image, profile photos, following, novels for writers and readers, private novels,
share a passage, and stats. Composition `WhatsNew`; source in `src/whatsnew/`. It reuses only the
Reel's pure pieces (`Paper`, `Blueprint`, palette, fonts); its own theme, timeline, devices and
captions keep the Reel's code untouched.

Deliverables (`out/`, not in git): `whats-new-walkthrough.mp4`, `whats-new-walkthrough.srt`,
`whats-new-cover.jpg` (the title frame at 0:08.8). Credits: `out/CREDITS.txt`.

1. **Data**: its own database `poemhub_dev_elm_wn` (`createdb`), migrated and seeded as for the Reel
   (`pnpm db:migrate`, `pnpm db:seed`, `seed-novels.ts`, `reel-fixtures.ts setup`), then
   `pnpm exec tsx --conditions=react-server reels-studio/scripts/whatsnew-fixtures.ts setup|assets|sessions`
   (the writer's "Akwaaba", the generated abstract photo and cover in `tmp/assets/`, desktop
   sessions in `tmp/sessions-wn.json`). Env as for the Reel, plus `PHOTO_STORAGE_DIR=reels-studio/tmp/storage-wn`,
   `E2E_PUSH_OUTBOX=…/tmp/push-outbox-wn.jsonl` and a throwaway VAPID key pair
   (`node -e "console.log(require('web-push').generateVAPIDKeys())"` from the worktree root) with
   `VAPID_SUBJECT=https://tryinkboard.elabo.me`.
2. **App**: `next dev -p 3357` with `NEXT_DIST_DIR=reels-studio/tmp/next-wn`. Two `APP_URL`s:
   `http://localhost:3357` for sections that touch the push API (it accepts only APP_URL's origin), and
   `https://tryinkboard.elabo.me` for those whose pictures and feed print addresses. Restore the root
   `tsconfig.json` and `next-env.d.ts` afterwards.
3. **Captures**: `node scripts/capture-wn.ts <section …>` → `captures/wn/` (copy the PNGs to
   `public/captures/wn/`). Order matters (each step builds on the last):
   - with `APP_URL=http://localhost:3357`: `photo follow novelsadmin poempub`, then
     `whatsnew-fixtures.ts chapters`, then `order readers private stats`;
   - with `APP_URL=https://tryinkboard.elabo.me`: `share passage feed`.
   `whatsnew-fixtures.ts reset-writer` removes the writer's novel and photo to retake them.
   Desktop is 1440×900 at 2×, phone 390×844 at 3×. The script stands in for the two browser halves
   `next dev` lacks, as the app's E2E tests do: push permission and subscription (`e2e/push-stub.ts`) and
   the service worker's replies to "Save this novel for offline", in the real worker's message format.
4. **Script and voice**: the narration is `src/whatsnew/script-source.json` (line ids, chapter cards, holds).
   `node scripts/wn-build.mjs script` → `src/whatsnew/data/script.json`; Kokoro `af_heart` with
   `~/Movies/InkBoard-video/tts/venv/bin/python -I scripts/voice.py src/whatsnew/data/script.json tmp/voice-wn`;
   word times from the audio with `tmp/whisper-venv/bin/python -I scripts/align.py src/whatsnew/data/script.json tmp/voice-wn src/whatsnew/data/voice-timing.json`,
   then `~/Movies/InkBoard-video/tts/venv/bin/python -I scripts/wn-refine.py tmp/voice-wn src/whatsnew/data/voice-timing.json`
   (moves Whisper's early word starts to where the voice comes back in); `node scripts/wn-build.mjs place`
   → `src/whatsnew/data/placement.json` (line starts, chapter cards, the length).
5. **Soundtrack**: `python3 -I scripts/mix.py --placement src/whatsnew/data/placement.json --timing src/whatsnew/data/voice-timing.json --voice-dir tmp/voice-wn --out tmp/soundtrack-wn.wav --stems`
   (the Reel's mix and ducking; `--stems` renders voice and ducked music separately, because in one graph
   ffmpeg ended the music with the last line and the ending had none).
6. **Video**: `npx remotion render src/index.ts WhatsNew tmp/wn-video.mp4 --codec=h264 --crf=18 --pixel-format=yuv420p --concurrency=2 --muted --jpeg-quality=95`, then
   `ffmpeg -i tmp/wn-video.mp4 -i tmp/soundtrack-wn.wav -map 0:v:0 -map 1:a:0 -c:v copy -af apad -c:a aac -b:a 192k -ar 48000 -t 172.6 -movflags +faststart out/whats-new-walkthrough.mp4`,
   `node scripts/wn-build.mjs srt`, and the cover: `ffmpeg -ss 8.8 -i out/whats-new-walkthrough.mp4 -frames:v 1 -q:v 2 out/whats-new-cover.jpg`.
   Preview stills: `node scripts/stills.mjs --comp WhatsNew 12 40 …`.

Captions page with `src/whatsnew/pages.ts` (≤ 54 characters, breaking at punctuation), shared by the
video and the SRT. Camera keys focus on a screen point in the capture's CSS px; every move is
`spring({ damping: 14, stiffness: 180 })`.

Changes to the Reel's scripts for this video are opt-in: `mix.py` takes `--placement`, `--timing`,
`--voice-dir`, `--out` and `--stems` (with none it builds the Reel's soundtrack, byte for byte as before),
`stills.mjs` takes `--comp`, and `reel-fixtures.ts` also accepts `poemhub_dev_elm_wn`.
