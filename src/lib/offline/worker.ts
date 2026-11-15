import { OFFLINE_RULES_JS, PAGES_CACHE_PREFIX, SAVE_MESSAGE, SAVED_INDEX_KEY, STATIC_CACHE_PREFIX } from "./rules";

/**
 * Source of the service worker served at /sw.js (src/app/sw.js/route.ts).
 * Hand-written and small on purpose: no library, no build step of its own.
 * The storage rules live in rules.ts (unit-tested); this file is the plumbing.
 *
 * Caches are versioned by build: `inkboard-static-<build>` (hashed assets and
 * the offline page) and `inkboard-pages-<build>` (saved reader pages plus an
 * index of them). When a new build activates, it fetches every saved page
 * again (without cookies, under the same rules) into its own cache, then
 * deletes every older cache. So a page saved by an old build, whose chunks may
 * be gone, is never served; a page that can't be refreshed is dropped.
 */
export function serviceWorkerSource(buildId: string): string {
  return `/* InkBoard offline reading (docs/PLAN.md, Phase 15 round 2). Build ${buildId}. */
"use strict";
${OFFLINE_RULES_JS}
var R = InkboardOffline;
var BUILD = ${JSON.stringify(buildId)};
var STATIC = ${JSON.stringify(STATIC_CACHE_PREFIX)} + BUILD;
var PAGES = ${JSON.stringify(PAGES_CACHE_PREFIX)} + BUILD;
var INDEX = ${JSON.stringify(SAVED_INDEX_KEY)};
var OFFLINE = "/offline";
var MIGRATION_BUDGET_MS = 10000;

// ---- the saved-pages index (serialised: saves can overlap) -----------------
var indexChain = Promise.resolve();
function withIndex(cacheName, change) {
  var run = indexChain.then(async function () {
    var cache = await caches.open(cacheName);
    var res = await cache.match(INDEX);
    var index = res ? await res.json() : [];
    var next = change(index);
    var drop = R.overCap(next);
    if (drop.length) {
      next = next.filter(function (e) { return drop.indexOf(e.url) === -1; });
      await Promise.all(drop.map(function (u) { return cache.delete(u); }));
    }
    await cache.put(INDEX, new Response(JSON.stringify(next), { headers: { "content-type": "application/json" } }));
  });
  indexChain = run.catch(function () {});
  return run;
}

// ---- assets ------------------------------------------------------------------
async function fromAnyStatic(request) {
  var mine = await caches.open(STATIC);
  var hit = await mine.match(request);
  if (hit) return hit;
  // An open tab of the previous build can still ask for its own chunks.
  var names = await caches.keys();
  for (var i = 0; i < names.length; i++) {
    if (names[i].indexOf(${JSON.stringify(STATIC_CACHE_PREFIX)}) === 0 && names[i] !== STATIC) {
      var old = await (await caches.open(names[i])).match(request);
      if (old) return old;
    }
  }
  return null;
}
async function cacheFirst(request) {
  var hit = await fromAnyStatic(request);
  if (hit) return hit;
  var res = await fetch(request);
  if (res.status === 200 && res.type === "basic") {
    var copy = res.clone();
    caches.open(STATIC).then(function (c) { return c.put(request, copy); });
  }
  return res;
}
async function cacheAssets(urls) {
  var cache = await caches.open(STATIC);
  await Promise.all(urls.map(async function (u) {
    if (await cache.match(u)) return;
    try {
      var res = await fetch(u, { credentials: "omit" });
      if (res.status === 200) await cache.put(u, res);
    } catch (e) {}
  }));
}

// ---- saving a reader page (rule 2: a cookie-less copy, never the reader's response)
// One save per page at a time; a later request always fetches again, so an
// answer like "gone" or "now private" is never skipped.
var inFlight = new Map();
function saveCopy(path) {
  var key = R.cacheKey(path);
  if (inFlight.has(key)) return inFlight.get(key);
  var run = doSave(key).finally(function () { inFlight.delete(key); });
  inFlight.set(key, run);
  return run;
}
async function dropPage(key) {
  await (await caches.open(PAGES)).delete(key);
  await withIndex(PAGES, function (index) { return index.filter(function (e) { return e.url !== key; }); });
}
async function doSave(key) {
  var cacheName = PAGES;
  var res;
  try {
    res = await fetch(key, { credentials: "omit", cache: "no-store", redirect: "manual", headers: { Accept: "text/html" } });
  } catch (e) {
    return; // offline: leave the saved copy alone
  }
  var html = res.type === "opaqueredirect" ? "" : await res.text();
  var v = R.verdict(res.status, res.headers.get("content-type") || "", html);
  if (v === "keep") return;
  var cache = await caches.open(cacheName);
  if (v === "drop") return dropPage(key);
  var meta = R.pageMeta(html);
  await cacheAssets(R.assetUrls(html));
  await cache.put(key, new Response(html, { status: 200, headers: { "content-type": res.headers.get("content-type") } }));
  await withIndex(cacheName, function (index) {
    var rest = index.filter(function (e) { return e.url !== key; });
    rest.push({ url: key, kind: meta.kind || R.readerKind(new URL(key, "http://x").pathname), title: meta.title, author: meta.author, savedAt: Date.now() });
    return rest;
  });
}
async function savedPage(key) {
  var cache = await caches.open(PAGES);
  return (await cache.match(key)) || (await cache.match(new URL(key, "http://x").pathname));
}
function toOfflinePage(key) {
  return Response.redirect(OFFLINE + "?from=" + encodeURIComponent(key), 302);
}

// ---- strategies ----------------------------------------------------------------
async function readerPage(event) {
  var key = R.cacheKey(event.request.url);
  try {
    var res = await fetch(event.request);
    // Whenever the network answers: gone (unpublished, deleted) drops the copy at
    // once; a page refreshes it (a cookie-less copy, under the storage rules).
    if (res.status === 404 || res.status === 410) event.waitUntil(dropPage(key));
    else if (res.status === 200) event.waitUntil(saveCopy(key));
    return res;
  } catch (e) {
    return (await savedPage(key)) || toOfflinePage(key);
  }
}
async function onlineOnly(event) {
  try {
    return await fetch(event.request);
  } catch (e) {
    return toOfflinePage(R.cacheKey(event.request.url));
  }
}
async function offlinePage(event) {
  try {
    return await fetch(event.request);
  } catch (e) {
    return (await (await caches.open(STATIC)).match(OFFLINE)) || new Response("You're offline.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
async function rscNavigation(event) {
  try {
    return await fetch(event.request);
  } catch (e) {
    // A non-RSC answer makes Next load the URL as a document instead of waiting
    // for the network; that document then comes from the saved pages or the
    // offline page. Never cached.
    return new Response("", { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-inkboard-offline": "document" } });
  }
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  var strategy = R.strategyFor({
    method: req.method,
    url: req.url,
    origin: self.location.origin,
    mode: req.mode,
    rsc: req.headers.get("RSC") === "1" || new URL(req.url).searchParams.has("_rsc"),
    prefetch: req.headers.has("Next-Router-Prefetch") || req.headers.has("Next-Router-Segment-Prefetch"),
  });
  if (strategy === "passthrough") return;
  if (strategy === "cache-first") return event.respondWith(cacheFirst(req));
  if (strategy === "reader-page") return event.respondWith(readerPage(event));
  if (strategy === "offline-page") return event.respondWith(offlinePage(event));
  if (strategy === "online-only") return event.respondWith(onlineOnly(event));
  if (strategy === "rsc-navigation") return event.respondWith(rscNavigation(event));
});

// A page shown by a soft navigation (the poem overlay) asks to be saved.
self.addEventListener("message", function (event) {
  var data = event.data || {};
  if (data.type !== ${JSON.stringify(SAVE_MESSAGE)} || typeof data.path !== "string") return;
  if (!R.readerKind(new URL(data.path, "http://x").pathname)) return;
  event.waitUntil(saveCopy(data.path));
});

// ---- lifecycle -------------------------------------------------------------------
self.addEventListener("install", function (event) {
  event.waitUntil((async function () {
    // The offline page and its assets, so it works with no network at all.
    var res = await fetch(OFFLINE, { credentials: "omit", cache: "no-store" });
    if (res.status === 200) {
      var html = await res.text();
      await cacheAssets(R.assetUrls(html));
      await (await caches.open(STATIC)).put(OFFLINE, new Response(html, { headers: { "content-type": res.headers.get("content-type") } }));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", function (event) {
  event.waitUntil((async function () {
    var names = await caches.keys();
    // Carry saved pages over from older builds by fetching them again (rules apply anew).
    var started = Date.now();
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (name.indexOf(${JSON.stringify(PAGES_CACHE_PREFIX)}) !== 0 || name === PAGES) continue;
      var res = await (await caches.open(name)).match(INDEX);
      var index = res ? await res.json() : [];
      for (var j = 0; j < index.length; j += 6) {
        if (Date.now() - started > MIGRATION_BUDGET_MS) break;
        await Promise.all(index.slice(j, j + 6).map(function (e) { return saveCopy(e.url).catch(function () {}); }));
      }
    }
    // Then remove every cache that isn't this build's.
    await Promise.all(names.filter(function (n) {
      return (n.indexOf(${JSON.stringify(PAGES_CACHE_PREFIX)}) === 0 || n.indexOf(${JSON.stringify(STATIC_CACHE_PREFIX)}) === 0) && n !== PAGES && n !== STATIC;
    }).map(function (n) { return caches.delete(n); }));
    await self.clients.claim();
  })());
});
`;
}
