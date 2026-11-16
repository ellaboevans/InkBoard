# Sharing a poem as an image (WhatsApp Status first, then Instagram Stories)

Research for a "Share as image" button: a portrait picture of a poem (its lines, title, author and InkBoard's address) that readers and writers post to their WhatsApp Status or send to a chat, and that brings people back to the poem. Readers are mostly in Ghana, mostly on Android phones.

Written 16 November 2026. Designs, flow and a summary for the owner: [docs/mockups/share-image/index.html](../mockups/share-image/index.html). A throwaway prototype backs the measurements (see "The prototype" at the end).

**How to read the sources.** Each claim is followed by a source number; the list is at the end, primary sources (WhatsApp/Meta help and developer docs, W3C/WHATWG specs, MDN, Chromium and WebKit source, Next.js and Vercel docs) before secondary ones (marked *secondary*). WhatsApp's Help Center pages carry no date; they are given as "undated, retrieved 2026-11-16". Meta's Ads Guide and Business Help pages and help.instagram.com could not be fetched (they render only with JavaScript), so figures attributed to them come through secondary sources. **Measured here** marks numbers from the prototype on this machine.

---

## Recommendation in short

1. **Render on the server, as a PNG, with the existing `next/og` setup**, at 1080×1920 for Status and Stories, and 1080×1350 (4:5) for chats. It took 30–120 ms per image here (Page and Ink designs), the file is 90–180 KB, and it is the same picture for everyone, cacheable per poem. The browser-canvas alternative shapes text better but needs its own line breaking, font loading and code on every phone, and gives nothing to cache.
2. **Set Ghanaian-language text in Gentium Book Plus first.** The `next/og` in this app bundles Satori 0.29.0, which has no mark positioning: tone marks on ɛ and ɔ land beside the letter when the letter and the mark come from different fonts. Putting Gentium first fixes it (verified). The live share cards (`og-card.tsx`) have the same bug today.
3. **Prepare the image file when the share sheet opens; call `navigator.share()` from the Share tap with nothing awaited first.** Chromium allows 5 s after a tap; preparing the file took 3.6 s on an emulated slow-3G connection.
4. **Print the address on the image** (InkBoard + host + path) and send the link as text with the image. Whether a link in a Status caption can be tapped is not documented and the reports disagree, so the printed address is what reliably brings readers back. A short link (`/s/…`) would make it easier to type.
5. **Public poems only.** Private poems get no image (their text must never appear, N1); people can still share the link, whose preview already shows only the title.

Phases, effort, risks and the owner's open questions are at the end.

---

## 1. The formats

### WhatsApp Status

- **Size.** WhatsApp documents only a minimum: its share-to-Status developer page lists "Supported formats: JPG, PNG / Recommended Minimum dimensions: 720px x 1280px", and gives an aspect ratio (9:16) for videos only [P3]. 1080×1920 (9:16) is the convention in secondary guides ("Design status at 1080 × 1920 pixels, 9:16", Spurnow, 2026-09-29 [S1]); WhatsApp itself doesn't state it.
- **Compression.** "The quality of media … uploaded into WhatsApp Status may be lower than the original version" [P2]; "media files are usually compressed when shared" [P4]. **HD doesn't apply to Status**: "HD media isn't currently available for status updates or profile pictures" [P1]. WhatsApp documents no maximum size or JPEG quality for Status. Measured by others, in chats not Status: standard quality "came back at 1280 to 1600 pixels on the long side", a Pixel 9a standard send at JPEG quality 67 (acciopix, updated 2026-10-01 [S2]); "longest edge does not exceed 1600 px … roughly equivalent to JPEG quality 70–80%" (DEV, 2026-09 [S3], method not shown). Nobody has measured Status specifically.
- **Cropping.** The composer has a crop tool [P2]; WhatsApp doesn't document automatic cropping or letterboxing. Secondary: "Wider images are letterboxed and a square floats in the middle" [S1]. For images posted through its native API, the background "defaults to the most dominant color" [P3].
- **Where WhatsApp's UI sits** (secondary only, and **the sources disagree**): top ≈ 250 px (progress bars, name, time) and bottom ≈ 400 px (reply bar, caption) of 1920 [S1][S4]; another guide says 250 px for both [S3]. None says how it measured. The prototype keeps the cautious figures: nothing important in the top 260 px or the bottom 400 px, 96 px at the sides.

### Instagram Stories

- **Size.** Instagram's own developer page: "Minimum dimensions 720x1280. Recommended image ratios 9:16 or 9:18", JPG or PNG [P8]. 1080×1920 is the usual recommendation [S5].
- **Safe zones.** Only the **ad** zones are published, and they're quoted differently: "14% (250 pixels) of the top and 20% (340 pixels) of the bottom" (Hootsuite, Nov 2026 [S5]) versus "the top 14%, the bottom 35% and 6% on each side" (adsap.ai, 2026-11-02, quoting the Ads Guide's Instagram Stories image page, and attributing 14/20 to Facebook Stories [S6]). An ordinary story's bottom bar is lighter than an ad's call-to-action; it isn't documented. The prototype's 260/400 px frame is inside the 14%/20% zone but not the 35% one.
- **Other ratios.** Images that don't fill 9:16 get an automatic, usually blurred background (secondary [S7]). Instagram documents no Stories compression.
- **From the web.** Instagram's documented "Sharing to Stories" is a native-app intent that needs a Facebook App ID [P8]; there is no web equivalent. From a website, the way in is the system share sheet (if Instagram is listed there for images) or saving the image and posting it from the gallery. **Not confirmed** whether Instagram's Android share target offers Stories for an image shared from Chrome.

### The same picture sent to a WhatsApp chat

- WhatsApp doesn't document how a chat bubble shows a tall image. Secondary: "Meta does not publish one for image messages … A tall image gets scaled down and small text stops being readable"; "Square or gently landscape is the safe habit" (DMly, 2026-03-23 [S8]); "1080 × 1350 pixels (4:5) or 1080 × 1080 pixels (1:1) work well, because both formats fill the chat bubble without heavy cropping" (Chatarmin, 2026-11 [S4]).
- **So a 4:5 version is worth having** for chats (and for feeds), with the 9:16 one for Status and Stories. Which one a person gets depends on where they're sending it, which the web page can't know: the prototype lets them choose ("Status or Story" / "Chat"). Square isn't worth a third layout: a 4:5 image already fills the bubble per [S4], and poems are taller than wide.

---

## 2. Getting the image there from the web

### Web Share with files

`navigator.share({ files })` hands a File to the phone's share sheet; `navigator.canShare({ files })` says whether this browser can.

| Browser | Files | Source |
| --- | --- | --- |
| Chrome Android | yes, since 75–76 (sources differ by one version) | MDN BCD [W1], ChromeStatus [W6] |
| Samsung Internet | yes, since 11.0 (caniuse: 8.2) | [W1], [W3] |
| Opera Android | yes (mirrors Chrome) | [W1], [W3] |
| Firefox Android | **no files** (text and URLs only) | [W1] |
| Android WebView (many in-app browsers) | **no Web Share at all** | [W1], Chromium flags [W4] |
| Safari iOS / macOS | yes from **15** (MDN says 14; WebKit says Level 2 was on by default in Safari 15 and corrected its 14.1 post) | [W1], [W7], [W8], [W9] |
| Other iOS browsers | same as Safari (WebKit); no test of file shares from Chrome iOS found | [W1] |
| Chrome/Edge desktop | Windows and ChromeOS (Chrome 89+), macOS from Chrome 128; **not Linux** | [W1], [W4], [W5], [W12] |
| Firefox desktop | no (flag only, no files) | [W1], [W3] |

- **File types.** Chromium's allowlist includes `png`/`image/png`, `jpeg`/`jpg`/`image/jpeg` and `webp`/`image/webp` (verified in the source) [W11]; MDN lists the same and says to "always test with navigator.canShare()" [W2]. At most 10 files and 50 MB per share in Chromium [W13].
- **User activation.** The spec: "If global does not have transient activation, return a promise rejected with a "NotAllowedError" … Consume user activation" [W17]. Chromium's window is 5 s (`kActivationLifespan = base::Seconds(5)`, verified in the source) [W14]; WebKit's is also 5 s today [W15]. Waiting on `fetch()` or `toBlob()` doesn't end activation by itself: only time, or another API consuming it, does. Chromium consumes it in the browser process, "so that a single gesture cannot be replayed into repeated share sheets" [W12]: one tap, one share. (A 2019 Chrome post says "about a second" [W18]; the current source says 5 s.) **The robust order:** make the File before the Share tap, then call `share()` directly in the click handler. **Measured here:** preparing the File (download the PNG, wrap it in a File) took 0.06–0.12 s on localhost, 0.8 s on emulated 3G (1.5 Mbps, 150 ms) and 3.6 s on emulated slow 3G (400 kbps, 400 ms); with the File ready, `share()` was called 0 ms after the click with `navigator.userActivation.isActive` true.
- **WhatsApp as a target, and text with the file.**
  - On Android, Chrome sends one share intent carrying the image and `EXTRA_TEXT`, which joins text and URL ("Concatenate text and URL with a space"); `title` becomes the subject [W21]. Whether WhatsApp uses that text as the caption (and whether **Status** keeps it) is WhatsApp's choice: **no primary source**. One secondary report: an image plus caption "works in Chrome" (2026-10-21 [W25]).
  - On iOS, reports say one half gets dropped when both are sent, and **they disagree on which**: "only the image is shared" (a native plugin's README, undated [W23]) versus "iPhone WhatsApp drops images with text" (2026-10-24 [W24]). The spec editor's view: "this is not a spec issue. Certain apps are clearly limited in what they are willing to receive" (2025-11-11 [W22]).
  - **So:** send the file with short text by default, and test both ways on real phones (the prototype has a "Send the link as text" switch for this).
- **Fallbacks.**
  - **Download:** `<a download>` works in iOS Safari since 13 [W28]; with `blob:` URLs it didn't work in WKWebView-based browsers (2020 [W29], not retested). A downloaded file lands in Files on iPhone, not Photos (not confirmed by a source).
  - **Long-press "Save to Photos"** on an `<img>`: not confirmed by a source fetched here.
  - **Copy the image** (`ClipboardItem` with PNG): Chrome Android 98+, Safari 13.1+; must be in a user gesture [W30][W31]. Pasting an image into WhatsApp from the clipboard is untested.
  - **Copy the link** (`writeText`), and a **WhatsApp text link** `https://wa.me/?text=urlencodedtext`, which opens a contact picker [P5]. WhatsApp then shows the link's preview from our Open Graph tags (the image "under 600KB … 300px or more in width", the tags in the first 300 KB of HTML [P6]), which the existing 1200×630 share cards meet.
- **In-app browsers and the installed app.** Android in-app browsers built on the system WebView have no Web Share [W1][W35]; the button should fall back there. WhatsApp's own in-app browser is only for business template links; links in normal messages "open in the phone's default browser" (secondary, 2025-11-18 [W34]). The installed InkBoard app runs in the browser on Android, so it should behave like Chrome (no explicit doc found).

---

## 3. Getting readers back to the poem

- **Links in a Status caption.** A text status with a link gets a preview ("when you post a link on your status, you'll automatically see a visual preview" [P7]; previews work "when the link is sent via chat or shared via status" [P6]). Whether a link in an **image** status caption is tappable is **not documented**, and secondary sources contradict each other ("WhatsApp renders it as unclickable plain text" [S9] versus "links in captions are clickable when viewers open the image" [S10]).
- **The printed address works everywhere,** including screenshots and reposts. The prototype prints "InkBoard · tryinkboard.elabo.me" and the path under it.
- **QR code:** some Android phones can scan a code on their own screen ("Use Circle to Search to scan QR codes … directly from your screen", on "selected Android devices" [P9]); WhatsApp isn't documented to recognise QR codes in images. A QR takes room in the safe area, survives reposts, and could suffer from recompression (untested). **Not recommended for phase 1**; reconsider if the owner hears people asking how to open the poem.
- **A shorter address.** Today's paths are long (`/p/abla-dzifa/instructions-for-the-house-sitter` is 44 characters), fine to read, tedious to type from a Status. A short link like `tryinkboard.elabo.me/s/k3x9q` is worth it if people type addresses; it needs a small table (code → poem, cascading on delete) and a redirect route (about a day). Owner's choice.

---

## 4. Rendering

### On the server: `ImageResponse` (next/og), as the share cards do

- **What's bundled.** `next@16.4.6` bundles `@vercel/og` 1.0.1 (verified in `node_modules`), which depends on **Satori 0.29.0** (verified in the npm registry) [R-npm]. Satori 0.29's README: "Advanced typography features such as kerning, ligatures and other OpenType features are not currently supported" [R2]. HarfBuzz shaping came later (PR #735, merged 2026-08-20 [R3]) and has its own open mark-position bug (#879, 2026-10-10 [R4]); `@vercel/og` 1.0.2 crashes on import (#801 [R5]). So the version here is the one to design for.
- **Ghanaian letters and tone marks. Measured here:** with Newsreader first and Gentium as fallback (as `og-card.tsx` does today), Satori takes ɛ from Gentium and the combining accent from Newsreader, and the accent lands beside the letter (ɛ´, ɔ´), with an odd gap after some words. Wrapping each cluster in a Gentium span breaks the baseline. **Gentium Book Plus first for the whole text places every mark correctly** (`docs/mockups/share-image/designs/text-satori.png`). The prototype uses Gentium first for any text with letters Newsreader lacks; Latin-only poems stay in Newsreader.
- **Other limits.** Flexbox only; fonts must be ttf/otf/woff, not woff2; 500 KB bundle [R1]. A `<div>` with more than one child must be `display: flex` (measured: a `display: block` paragraph mixing plain and italic text is refused), so lines are laid out word by word to wrap across emphasis. `lineClamp` works on a single text node with `display: block` (measured; matches #778 [R6]). Output is PNG only [R1].
- **Cost and time. Measured here** (production build, this Mac, one request at a time):
  - Page and Ink designs: 30–60 ms per 1080×1920 PNG (up to 200 ms for the very first render after the server starts), the same for repeats.
  - Board design: 450–510 ms. Its dotted background and shadow are the likely cause (not profiled). A production version should drop or simplify them.
  - Files: 93–181 KB as PNG.
- **On Vercel.** Fluid compute bills active CPU and memory, with 1 million invocations included on Hobby and $0.60 per million beyond on Pro [R7]. A function response is cached on the CDN only with `s-maxage` (up to a year, best-effort, per region) [R8]; Next's image wrapper sends `public, max-age=0, must-revalidate` by default [R1-src], so a share-image route must set its own header. Two ways to cache:
  - `"use cache"` around the PNG bytes, tagged with the poem's tag (`poemTag(id)`) and `BOARD_TAG`, so an edit, rename or unpublish refreshes it;
  - a versioned URL (`?v=<updated_at>`) with a long `s-maxage`.
  Either way a poem costs one render per change, not one per share.

### In the browser: canvas

- Canvas text uses the browser's own shaping ("a hypothetical infinitely-wide CSS line box" [R9]). **Measured here (desktop Chrome):** the same Ewe line renders correctly with either font order, because the browser falls back per cluster. Not checked on Android or iPhone.
- The costs:
  - no automatic line wrapping (`fillText` only condenses to `maxWidth` [R10]), so lines must be measured and broken by hand;
  - fonts must be loaded first, and our Gentium/Andika subsets have no basic Latin, so `document.fonts.load()` needs the poem's text or the subset never loads [R11];
  - Safari can't export WebP (asking for it silently returns PNG) [R12][R13];
  - the canvas code ships to every phone;
  - every phone redraws the image, and there's no URL to cache or preview.
- Canvas size limits (4096² or 8192² on iOS [R14][R15]) aren't a problem at 1080×1920.

**Verdict:** the server, with Gentium first. The canvas wins only on shaping, and the font-order fix closes that gap for the letters InkBoard needs.

### PNG or JPEG

- **Measured here,** over 30 renders:
  - PNG: 87–181 KB (the flat paper colours compress well).
  - JPEG from the browser's canvas: 55–170 KB at quality 0.9 and 45–135 KB at 0.8. Hardly smaller for text-heavy poems, and softer.
  - A WhatsApp-like re-encode (1600 px long side, quality 0.7, the secondary figures above): 30–112 KB. Tone marks stay legible (`designs/nunya-page-story-whatsapp-like.jpg`).
- WhatsApp re-encodes either way [P2][P4]. **Use PNG.**
- For mobile data, a reader downloads one 90–180 KB image when they open the share sheet, about the size of one share card. Nothing loads until they ask.
- WebP isn't worth it: no Safari export [R12], and WhatsApp's handling of WebP from the share sheet in the consumer app is unconfirmed (the Business API transcodes WebP to JPEG [R16]).

---

## 5. What goes on the image

- **Lines.** The whole poem when it fits; otherwise lines from the start, ending at a stanza break when that keeps most of what fits, with "Read the whole poem on InkBoard". Optionally, **lines the reader picks** (as music apps do with lyrics), headed "Lines from" with the title; the prototype caps a pick at 12 lines.
- **Size.** The type is the largest that fits **with every line on one row** (a poem's line breaks are the poet's), falling back to wrapped lines at 44 px. Very long lines therefore make the type smaller; picking lines is the way out.
- **Title.** Up to three lines, then an ellipsis.
- **Light Markdown.** *Italic* kept. **Bold** shows upright in the prototype, because no bold faces are loaded; production can add static bold TTFs.
- **Byline and brand.** The avatar, the pen name and the language ("in Ewe"); InkBoard's mark, name, host and path.
- **Safe area.** All of the above sits inside the 260/400 px safe area; only the background reaches the edges.
- **Text sent with the image** (also the accessible version, since WhatsApp shows no alt text): “Title” by Pen name, on InkBoard: link. The owner could add the first line; it repeats the image but helps someone using a screen reader.

## 6. Rules

- **Private poems: no image.** Their text must never be on one (N1). The route refuses them (403), and the reader loader already returns no body for them. A title-only "password protected" card is possible, but it invites people to ask for the password in public, and the normal link already previews as title-only. **Recommended: none.** Owner's choice.
- **Who can share.**
  - **Any reader,** from the poem page and the overlay, for public poems.
  - **The author,** from the dashboard after a first publish (next to "Poem published"), from a poem's row menu, and from the welcome checklist's share step (which today copies the author-page link).
  - Drafts: never.
- **Accessibility.**
  - The button and sheet are ordinary labelled controls.
  - The shared text carries title, author and link.
  - The preview `<img>` has alt text.
- **Privacy and CSP. Nothing changes:**
  - images are same-origin;
  - `blob:` is already allowed in `img-src`;
  - the share sheet is the phone's;
  - nothing new is stored.
  - A short-link table would hold no personal data, but if added, the Privacy page should still mention it under the CLAUDE.md rule.
- **Analytics.** Vercel Analytics strips query strings, so `?via=status` wouldn't be counted. A short-link redirect could count visits per code if the owner wants to know whether this works.

---

## 7. Plan

| Phase | What | Effort |
| --- | --- | --- |
| 0 | Fix the live share cards: Gentium first for Ghanaian text in `og-card.tsx` (tone marks are misplaced today). Test with an Ewe title. | ½ day |
| 1 | Share as image for public poems: server PNG at 1080×1920, one design (Page), cached per poem; button on the poem page and overlay; sheet with preview, Share (files + text), Download, Copy link, WhatsApp link; tests (unit for fitting, E2E like the prototype's, axe). | 2–3 days |
| 2 | Chat size (4:5); choose lines; author entry points (after publish, row menu, checklist); bold faces. | 2 days |
| 3 | Short links (`/s/…`) printed on the image, with a visit count; Instagram Stories check; a second design if wanted. | 1–2 days |

**Risks**
- WhatsApp's handling of the caption, of Status quality and of the chat thumbnail is undocumented and may change. Mitigation: the printed address doesn't depend on any of it.
- iPhone WhatsApp may drop the image or the text when both are sent. Mitigation: test, and send the file alone on iOS if needed.
- On a slow network, preparing the file can take a few seconds. Mitigation: show the preview loading, and enable Share only once the file is ready.
- Satori upgrades could change text shaping (HarfBuzz versions have their own mark bug [R4]). Mitigation: a visual test of an Ewe render.
- Long poems shrink the type. Mitigation: choose lines.

**Open questions for the owner** (also on the mockup page)
1. Which design: Page, Board, Ink, or Page plus Ink as a dark option?
2. Choose lines in phase 1 or later?
3. A short link on the image (`/s/…`), or the full address?
4. Send the link as text with the image (the default), or the image alone?
5. Private poems: no image (recommended), or a title-only card?
6. Where authors get the button: after publishing, the row menu, the checklist?
7. A 4:5 chat version in phase 1 or 2?
8. QR code: not now (recommended)?

## 8. What couldn't be verified here

- Any WhatsApp-documented Status image size, resolution limit, JPEG quality or overlay position; whether Status crops non-9:16 photos; how the chat bubble crops tall images.
- Whether WhatsApp Status appears in Android's share sheet for a web-shared image and keeps the text; what iPhone WhatsApp does with file + text today.
- Whether a link in an image status caption can be tapped.
- Instagram's organic Stories safe zones and compression; whether Instagram's Android share target offers Stories.
- Canvas shaping on Android Chrome and iOS Safari (checked on desktop Chrome only); long-press save on iOS; `<a download>` with `blob:` in Chrome iOS.
- Everything on real phones: the prototype stubs the share sheet. To test for real:
  1. Deploy a Vercel preview with `SHARE_IMAGE_PROTOTYPE=1` set for Preview only.
  2. Open a public poem on an Android phone (Chrome, then Samsung Internet) and on an iPhone (Safari).
  3. Tap Share as image, then Share…, and pick WhatsApp. Post to My status and send to a chat.
  4. Check, after posting:
     - the caption;
     - whether the link can be tapped;
     - quality and tone marks;
     - what's hidden under the bars;
     - the chat thumbnail.
  5. Repeat with JPEG, with "Send the link as text" off, and in Firefox Android (it should offer Download instead).

---

## Sources

Primary unless marked *secondary*. Retrieved 2026-11-16.

**WhatsApp, Meta, Instagram, Google**
- [P1] WhatsApp Help Center, "About HD photos and videos", https://faq.whatsapp.com/759301289012856/?cms_platform=android, undated
- [P2] WhatsApp Help Center, "How to create and share a status", https://faq.whatsapp.com/643144237275579/, undated
- [P3] WhatsApp Help Center, "How to integrate status with third-party apps", https://faq.whatsapp.com/669870872481343/?cms_platform=android, undated
- [P4] WhatsApp Help Center, "How to send media, contacts, or location", https://faq.whatsapp.com/453914586839706/?cms_platform=android, undated
- [P5] WhatsApp Help Center, "How to use click to chat", https://faq.whatsapp.com/5913398998672934, undated
- [P6] Meta for Developers, "Link Previews" (WhatsApp Business Messaging), https://developers.facebook.com/documentation/business-messaging/whatsapp/link-previews/, updated 2026-05-21
- [P7] Meta Newsroom, "Introducing New WhatsApp Status Features", https://about.fb.com/news/2023/02/new-whatsapp-status-features/, 2023-02-07
- [P8] Meta for Developers, "Sharing to Stories" (Instagram Platform), https://developers.facebook.com/docs/instagram-platform/sharing-to-stories, updated 2026-06-30
- [P9] Android, "How do you scan QR codes on Android?", https://www.android.com/intl/en_uk/articles/how-do-you-scan-qr-codes-on-android/, 2026-06-10

**Web Share, activation, browsers**
- [W1] MDN browser-compat-data, `api/Navigator.json`, https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json, last commit 2026-11-16
- [W2] MDN, "Navigator: share() method", https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share, last changed 2026-07-16
- [W3] caniuse, "Web Share API", https://caniuse.com/web-share, data 2026-11-11
- [W4] Chromium, `runtime_enabled_features.json5`, https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/runtime_enabled_features.json5, main
- [W5] Chrome for Developers, "Chrome 128 release notes", https://developer.chrome.com/release-notes/128, 2024-08-20
- [W6] Chrome Platform Status, "Web Share API Level 2", https://chromestatus.com/feature/4777349178458112, undated
- [W7] WebKit, "New WebKit Features in Safari 15", https://webkit.org/blog/11989/new-webkit-features-in-safari-15/, 2021-10-26
- [W8] WebKit, "New WebKit Features in Safari 14.1", https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/, 2021-04-29 (corrected)
- [W9] WebKit Bugzilla 198606, https://bugs.webkit.org/show_bug.cgi?id=198606, comment 2021-01-11
- [W10] web.dev, "Integrate with the OS sharing UI with the Web Share API", https://web.dev/articles/web-share
- [W11] Chromium, `webshare/FILE_TYPES.md`, https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webshare/FILE_TYPES.md, main (verified)
- [W12] Chromium, `chrome/browser/webshare/share_service_impl.cc`, https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/webshare/share_service_impl.cc, main
- [W13] Chromium, `modules/webshare/navigator_share.cc`, https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webshare/navigator_share.cc, main
- [W14] Chromium, `user_activation_state.h`, https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/public/common/frame/user_activation_state.h, main (verified: 5 s)
- [W15] WebKit, `LocalDOMWindow.cpp`, https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/LocalDOMWindow.cpp, main
- [W16] WHATWG HTML, "User interaction", https://html.spec.whatwg.org/multipage/interaction.html#transient-activation-duration, 2026-11-16
- [W17] W3C, Web Share API (Editor's Draft), https://w3c.github.io/web-share/, undated
- [W18] Chrome for Developers, "Making user activation consistent across APIs", https://developer.chrome.com/blog/user-activation, 2019-01-14
- [W19] WebKit Bugzilla 197779, https://bugs.webkit.org/show_bug.cgi?id=197779, 2019–2020
- [W20] WebKit, `Navigator.cpp`, https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Navigator.cpp, main
- [W21] Chromium, `ShareHelper.java` / `ShareParams.java`, https://chromium.googlesource.com/chromium/src/+/main/components/browser_ui/share/android/java/src/org/chromium/components/browser_ui/share/ShareHelper.java, main
- [W22] W3C, w3c/web-share issue #279, https://github.com/w3c/web-share/issues/279, 2023-07-24 to 2025-11-11
- [W23] *secondary* EddyVerbruggen, SocialSharing plugin README, https://github.com/EddyVerbruggen/SocialSharing-PhoneGap-Plugin, undated
- [W24] *secondary* GitHub PR (AI-written), https://github.com/Mr-B042/Protohub/pull/836, 2026-10-24
- [W25] *secondary* GitHub issue, https://github.com/shiaho777/web-to-app/issues/1337, 2026-10-21
- [W28] MDN browser-compat-data, `html/elements/a.json`, https://github.com/mdn/browser-compat-data/blob/main/html/elements/a.json
- [W29] WebKit Bugzilla 167341, https://bugs.webkit.org/show_bug.cgi?id=167341, comment 2020-09-23
- [W30] MDN browser-compat-data, `api/ClipboardItem.json`, https://github.com/mdn/browser-compat-data/blob/main/api/ClipboardItem.json
- [W31] MDN, "Clipboard: write() method", https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write, 2026-10-20
- [W34] *secondary* Wati, "Meta introduces In-app Browser (IAB) experience for WhatsApp", https://support.wati.io/en/articles/12867737-meta-introduces-in-app-browser-iab-experience-for-whatsapp, 2025-11-18
- [W35] *secondary* react-native-webview issue #1262, https://github.com/react-native-webview/react-native-webview/issues/1262, 2020-03-19

**Rendering, hosting**
- [R1] Next.js, "ImageResponse", https://nextjs.org/docs/app/api-reference/functions/image-response, 2026-08-06; [R1-src] installed `next/dist/server/og/image-response.js` (default Cache-Control)
- [R-npm] npm registry, `@vercel/og` 1.0.1, https://registry.npmjs.org/@vercel/og/1.0.1 (verified: `satori` 0.29.0)
- [R2] vercel/satori README at 0.29.0, https://github.com/vercel/satori/blob/0.29.0/README.md, 2026-07-23
- [R3] vercel/satori PR #735, https://github.com/vercel/satori/pull/735, merged 2026-08-20
- [R4] vercel/satori issue #879, https://github.com/vercel/satori/issues/879, 2026-10-10
- [R5] vercel/satori issue #801, https://github.com/vercel/satori/issues/801, 2026-09-07
- [R6] vercel/satori issue #778, https://github.com/vercel/satori/issues/778, 2026-07-29
- [R7] Vercel, "Fluid compute pricing", https://vercel.com/docs/functions/usage-and-pricing, 2026-06-16
- [R8] Vercel, "Vercel CDN Cache", https://vercel.com/docs/caching/cdn-cache, 2026-09-14
- [R9] WHATWG HTML, canvas text, https://html.spec.whatwg.org/multipage/canvas.html
- [R10] MDN, "CanvasRenderingContext2D: fillText()", https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/fillText
- [R11] MDN, "FontFaceSet: load() method", https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/load
- [R12] MDN browser-compat-data, `api/HTMLCanvasElement.json`, https://github.com/mdn/browser-compat-data/blob/main/api/HTMLCanvasElement.json, 2026-11-09
- [R13] MDN, "HTMLCanvasElement: toBlob()", https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob, 2026-10-12
- [R14] MDN, "&lt;canvas&gt;", https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas, 2026-04-24 (says 4096², which **conflicts** with [R15])
- [R15] WebKit commit d1f63c0, https://github.com/WebKit/WebKit/commit/d1f63c061eadee6c83dc9fa06a2725c3d099a86b, 2024-03-15
- [R16] Meta for Developers, "Image messages" (WhatsApp Business), https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/image-messages/, 2026-11-04

**Secondary guides (formats)**
- [S1] *secondary* Spurnow, "WhatsApp Image Size Guide", https://www.spurnow.com/en/blogs/whatsapp-image-size, 2026-09-29
- [S2] *secondary* acciopix, "Does WhatsApp Compress Photos?", https://acciopix.com/blog/stop-whatsapp-compression-wedding-photos, updated 2026-10-01
- [S3] *secondary* DEV Community, "WhatsApp Image Dimensions & Compression Guide", https://dev.to/eldhopaulose/whatsapp-image-dimensions-compression-guide-2026-cheatsheet-client-side-resizer-pipeline-5h2b, 2026-09
- [S4] *secondary* Chatarmin, "WhatsApp Image Size Guide 2026", https://chatarmin.com/en/blog/whats-app-image-size-guide, 2026-11-16
- [S5] *secondary* Hootsuite, "Social media image sizes for all networks", https://blog.hootsuite.com/social-media-image-sizes-guide/, Nov 2026
- [S6] *secondary* adsap.ai, "Instagram Reels and Stories safe zones", https://adsap.ai/blog/instagram-reels-stories-safe-zones, 2026-11-02
- [S7] *secondary* Zeely, https://zeely.ai/blog/how-to-change-instagram-story-background-color/, 2026-03-25
- [S8] *secondary* DMly, "WhatsApp file size guide", https://dmly.io/whatsapp-file-size-guide/, 2026-03-23
- [S9] *secondary* LinkWA, https://linkwa.in/blog/how-to-add-clickable-link-whatsapp-status/, 2026-10-06
- [S10] *secondary* Secret Message Link, https://secretmessage.net/secret-message-link-whatsapp-status/, 2026-10-08

**Method.** Sources were fetched with `curl` (the pages' text, not screenshots). Four claims were re-checked directly at the source for this doc: the 5 s activation window [W14], the file-type allowlist [W11], and the `@vercel/og` 1.0.1 → Satori 0.29.0 dependency [R-npm] (plus the installed package). WhatsApp's Help Center pages render their text with JavaScript; their quotes come from a fetch that got the text, and a second fetch here returned only the script shell.

---

## The prototype (throwaway)

Not on main: it's kept on the local branch `research/share-image-prototype` (`git show research/share-image-prototype:<path>` to read a file), behind `SHARE_IMAGE_PROTOTYPE=1`; not the production feature. The paths below are on that branch.
- `src/components/brand/share-image-prototype.tsx`: the three designs and the fitting rule (Satori JSX).
- `src/app/prototype/share-image/[author]/[poem]/route.tsx`: the image for a public poem (`?design=page|board|ink&format=story|portrait&lines=5-7`). Private poems get 403, unknown ones 404.
- `src/components/poem/share-image-prototype.tsx` and a few lines in `poem-reader.tsx`: the button and its sheet.
- `docs/mockups/share-image/`:
  - `seed.mjs`: fixtures;
  - `render-designs.mjs`: PNGs and `measurements.json`;
  - `flow-shots.mjs`: screenshots;
  - `share.spec.ts` and its `playwright.config.ts`: the share path, with the sheet stubbed.
