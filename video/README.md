# InkBoard walkthrough videos

Two videos made from the real app, recorded and edited by script:

- **Walkthrough**: 1920×1080, about 6 minutes, five chapters (reading; follow, share, install; writing; signing in without email; your account).
- **Reel**: 1080×1920, about 70 seconds, for Instagram Reels, TikTok and YouTube Shorts. It opens on its hook, keeps text and key UI inside the platforms' safe zones, and ends on the end card.

There's no voice and no music. On-screen captions carry the story, and each file has a silent stereo track so every platform accepts it.

## Rebuild everything

```bash
pnpm video          # prepare → record → render → finish → check (Node 22+, local Postgres, Chrome)
```

The output goes to `video/.out/final/` (gitignored):

| File | What |
| --- | --- |
| `inkboard-walkthrough.mp4`, `inkboard-reel.mp4` | H.264 High, yuv420p, 30 fps, AAC silent track, faststart |
| `*.srt` | Captions, timed to the video |
| `*-voiceover.md` | The script with start/end times, for recording a voice later |
| `*-cover.png` / `*-cover.jpg` | Thumbnails (1920×1080 and 1080×1920) |

Contact sheets (a frame every 4 s for the walkthrough, every 3 s for the reel, with the reel's safe zones drawn on) go to `video/.out/sheets/`. Look through them after every rebuild.

### In steps

A full run takes 30–40 minutes. Each step can be run alone:

```bash
pnpm video prepare                   # fresh video database: pnpm db:seed + video/scripts/demo-content.ts, then next build
pnpm video record [scene …]          # all takes, or some (see `pnpm video list`); order matters, see below
pnpm video render walkthrough [n …]  # all parts, or parts n (0–4)
pnpm video render reel
pnpm video finish                    # join parts, add the audio track, write captions, script and covers
pnpm video check                     # ffprobe both videos and make contact sheets
pnpm video stop                      # stop a server left behind by an interrupted run
```

Takes share state in recording order. The writer signs up before she writes, the inbox shows the emails from the security takes, and `delete` removes her account. If you re-record some takes, re-record from the first one that shows the writer through to `delete`, so her avatar and poems stay consistent.

## How it works

- **Database and servers.** Everything runs on a database of its own, `poemhub_video_<worktree>` (override with `VIDEO_DATABASE_URL`), and on ports 3247/3248 (override with `VIDEO_PROD_PORT` / `VIDEO_DEV_PORT`). Only servers started from this checkout are ever stopped.
  - **prod:** a production build in `video/.out/next-prod`, used for reader, phone (offline and install) and most writer scenes. APP_URL is the live site, so URLs on screen are the real ones. The Resend key is a placeholder, and nothing recorded there sends email.
  - **dev:** `next dev` with the E2E outbox (no Resend key), for the scenes that send email: sign-up, recovery codes, passkeys, "This isn't my device", deleting the account. Emails are written to `video/.out/outbox.jsonl`, never sent. Each dev scene is rehearsed once unrecorded, so Server Actions compile before the real take. The dev indicator is hidden by the recorder.
- **Demo content** (`scripts/demo-content.ts`): the seed authors, plus fictional Akan, Ewe and Ga authors (all `@example.com`), collections, profiles, and the writer, Abla Dzifa (`abla.demo@example.com`). The Akan, Ewe and Ga texts are well-known proverbs and greetings with English glosses. **Have a native speaker check them before publishing.**
- **Recording** (`lib/recorder.ts`, `scenes/*.ts`):
  - Playwright drives Chrome like a person: eased pointer moves, typing, touch gestures on the phone.
  - Frames come from the DevTools screencast at device scale 2 (desktop, 1280×720) or 3 (phone, 390×844). Chrome runs with `--force-device-scale-factor`, because the screencast otherwise sends CSS-size frames.
  - An injected script draws the cursor or touch dot with click ripples, and hides scrollbars and the dev indicator.
  - Scenes log captions, camera focus rectangles, marks, cuts (server waits left out of the edit) and fast sections (typing, played faster).
  - The only app-importing code is `scripts/fixtures.ts`, run with `tsx --conditions=react-server`.
- **Editing** (`render/*.ts`):
  - A canvas compositor (`@napi-rs/canvas`, MIT) draws each frame and pipes it to ffmpeg: the branded dot-grid background, the browser or phone frame, eased zooms, captions, title cards, crossfades.
  - All text and chrome is drawn by Chrome on a page of the app itself (`render/overlays.ts`), so it uses the app's fonts and palette.
  - The edits are `render/videos.ts`: walkthrough captions come from the scenes, and the reel has its own shorter ones.

Typecheck the tooling with `pnpm exec tsc -p video/tsconfig.json`. The root typecheck excludes `video/`.

## Notes

- Install: headless Chrome never fires `beforeinstallprompt`, so the take simulates it, as `e2e/install-nudge.spec.ts` does. Chrome's own install dialog can't be filmed. The caption says "Confirm in your browser", and the next shot is the app opened full screen, without browser chrome.
- Passkeys use Chrome's virtual authenticator.
- The security emails in the inbox scene are the app's real templates (`src/server/email-templates.ts`), filled in with what the outbox recorded, with links pointing at the live site. The surrounding inbox is a plain, neutral window made for the video.
