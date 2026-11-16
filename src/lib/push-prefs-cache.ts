/**
 * Where the browser keeps a copy of its notification preferences (mode and
 * followed author slugs; Phase 18 round 2): Cache Storage, readable by the
 * page and the service worker alike, under its own cache name, which the
 * worker's per-build cache cleanup never deletes. Not secret: author slugs.
 * Used to re-apply follows when the server lost a subscription or the push
 * service replaced it (pushsubscriptionchange).
 */
export const PUSH_PREFS_CACHE = "inkboard-push";
export const PUSH_PREFS_KEY = "/__inkboard/push-prefs.json";
