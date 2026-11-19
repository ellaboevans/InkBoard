# InkBoard launch Reel (reels-studio)

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
