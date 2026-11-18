# Notifications: setup and testing on real devices

How notifications about new poems work is in `docs/PLAN.md` (Phase 18); why, and what each platform supports, in `docs/research/push-notifications.md`. This page covers what the owner needs to do.

## 1. Generate VAPID keys (once per environment)

```bash
pnpm exec web-push generate-vapid-keys
```

It prints a **public key** (87 characters) and a **private key** (43 characters).
- Use **one pair for production** and keep it. Every subscription is bound to the public key, so a new pair makes every existing subscription stop working. Readers' devices re-subscribe quietly the next time they open InkBoard, but anyone who doesn't come back stops getting notifications.
- Previews can share a separate pair.
- Never commit either key. Locally they go in `.env.local`, which is gitignored.

## 2. Set them on Vercel

Project → Settings → Environment Variables:

| Name | Value | Environments |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` | the public key | Production (and Preview, with the preview pair) |
| `VAPID_PRIVATE_KEY` | the private key, marked **Sensitive** | same |
| `VAPID_SUBJECT` | `mailto:you@yourdomain` or `https://yourdomain` | same |

- **The subject** must be a real address or https URL. Apple rejects `localhost`, `.invalid`, `.test` and the like with `BadJwtToken`, and iPhones then never get anything.
  - In production you can leave it out: it defaults to `APP_URL` when that's a public https URL.
  - On previews, set it explicitly.
- **Redeploy after setting them.** The public key is built into the pages and the service worker, so a build has to pick it up.
- **Without both keys the feature is off:** the switch is hidden and nothing is sent. With only one key, or with an unusable subject, the server refuses to start requests and says which variable is wrong.

The daily cleanup cron, which you already have, also removes notification addresses we couldn't use for 90 days.

## 3. Locally

Add to `.env.local`:

```
VAPID_PUBLIC_KEY=…
VAPID_PRIVATE_KEY=…
VAPID_SUBJECT=mailto:you@yourdomain
```

The service worker only runs in production builds, so try notifications with `pnpm build && pnpm start`, not `pnpm dev`. Chrome, Firefox and Safari all allow notifications on `http://localhost`.
1. Open the board, then Subscribe → "Notifications on this device" → Allow.
2. Publish a public poem from another browser (or a private window) signed in as an editor.
3. A notification arrives within a second or two; clicking it opens the poem.

## 4. Testing on real phones (a Vercel preview)

Phones need HTTPS, so use a preview deployment (with the VAPID variables set for Preview).
- If Deployment Protection (Vercel Authentication) is on for previews, turn it off for this test or use a shareable link. Otherwise the service worker can't fetch the pages it needs.
- Use a **second browser or device as the editor** who publishes, so the phone is a plain reader.

### Android (Chrome; also Samsung Internet, Firefox, Edge)

1. Open the preview URL in Chrome. Optional: install it (menu → Install app, or the install card) and open it from the home screen.
2. Tap Subscribe (the RSS icon) → turn on "Notifications on this device" → Allow. If you installed it, the "Get notified about new poems" card offers the same switch once.
3. Lock the phone. Publish a **public** poem from the other device. You should see "*Title*", "New poem by *Pen name*" with the InkBoard icon, and a small feather in the status bar.
4. Tap it: InkBoard opens on the poem.
5. Try again with Chrome swiped away from recent apps: it should still arrive.
6. Try airplane mode after the notification arrives, then tap it: the poem should still open, because it was saved for offline reading.
7. Check that nothing arrives for:
   - a **private** poem;
   - a second poem by the **same author** within 12 hours;
   - a **fourth** poem in 24 hours.
8. Turn the switch off, publish again: nothing arrives.

### iPhone / iPad (iOS 16.4 or later)

1. Open the preview URL in Safari. Subscribe → the notifications section says "Add InkBoard to your Home Screen first". That's expected: iOS only allows notifications for Home Screen web apps.
2. Share → **Add to Home Screen** → open InkBoard **from the Home Screen icon**.
3. The "Get notified about new poems" card appears once. Turn the switch on, then Allow. (Or use Subscribe → the switch.)
4. Lock the phone, then publish a public poem from another device. The notification shows on the Lock Screen.
5. Tap it: the InkBoard app opens on the poem. WebKit has had bugs around this (research doc §2.5), so please note exactly what happens.
6. Repeat steps 7–8 from Android.
7. Settings → Notifications → InkBoard → off: the switch in the app then shows "blocked", with instructions.

### Following authors and grouped notifications (round 2)

On each phone:
1. **Follow an author.** With notifications off, open an author's page and tap "Notify me about new poems by …". The permission prompt appears, then the button shows as on. Subscribe should now show "Only authors I follow" with that author listed.
2. **Mode filtering.** Publish a poem by **another** author: nothing arrives. Publish one by the followed author: it arrives.
3. **Grouping.** Publish a second and a third poem by the followed author, minutes apart.
   - **Android/Chrome:** the first notification should change to "2 new from …", then "3 new from …", in place, **without a new sound or vibration**. Tapping it opens the author's page.
   - **iPhone/iPad and Safari on a Mac:** only the first poem arrives; the later ones are not announced. That's on purpose: Safari doesn't replace notifications, so each update would arrive as another buzzing notification.
4. **Unfollow.** Unfollow from the popover, publish again: nothing arrives. Switch to "All new poems": everything arrives again.
5. **Re-registration.** Note whether a follow survives reinstalling the app or clearing site data. It shouldn't survive clearing site data (that removes the subscription itself), but it should survive the browser silently renewing the subscription.

### New chapters of novels (Phase 24)

New chapters go **only to devices that follow the author**, even in "All new poems" mode (an owner's decision). On each phone:
1. **Followers only.** With "All new poems" on and the author **not** followed, have the author publish a chapter: nothing arrives. Follow them (on their page or the novel page) and publish another chapter: it arrives, titled "New chapter: *Novel*, Chapter *n*", "By *Pen name*", and tapping it opens the chapter.
2. **Once only.** Unpublish that chapter and publish it again: nothing arrives the second time.
3. **Shared limits.** A poem and a chapter by the same author within 12 hours group into one notification ("2 new from …") on Android, and count together toward the three alerts a day.

### What to report back

For each device: model, OS and browser version, installed or not, whether the notification arrived (locked and unlocked), what it looked like (a screenshot), and what tapping did.

## 5. Troubleshooting

- **Nothing arrives anywhere.** Check the function logs for `[push]` lines. A `403` or `400` usually means a wrong key pair or subject.
- **Only iPhones get nothing.** Almost always the subject: it must be a real `mailto:` or `https:` value.
- **The switch is missing.** The VAPID keys weren't set when the deployment was built: set them and redeploy.
