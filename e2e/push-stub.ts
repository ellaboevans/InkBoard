import type { BrowserContext } from "@playwright/test";

/*
 * Notifications E2E (Phase 18) against `next dev`, where there is no service
 * worker: this stands in for the browser's half (Notification permission, the
 * registration's PushManager) so the switch's real requests reach the real
 * API and database. The push service itself is never involved; the
 * production spec (e2e-offline/notifications.spec.ts) drives the real worker.
 *
 * window.__push records what the page asked for: permission prompts and
 * subscribe/unsubscribe calls.
 */

export type FakePush = {
  /** What Notification.permission says, and what requestPermission() answers. */
  permission: NotificationPermission;
  answer?: NotificationPermission;
  /** Start with a subscription in this browser (as if turned on earlier). */
  subscribed?: boolean;
  /** No web push at all (old browsers; iPhone Safari outside the Home Screen app). */
  unsupported?: boolean;
};

// Real key material, as a browser sends it (it passes the server's checks).
const P256DH = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const AUTH = "tBHItJI5svbpez7KI4CCXg";

export async function fakePush(context: BrowserContext, opts: FakePush) {
  await context.addInitScript(
    ([opts, P256DH, AUTH]) => {
      if (location.protocol === "about:") return; // the blank first page has no storage
      const w = window as unknown as Record<string, unknown>;
      const rec = { prompts: 0, subscribes: 0, unsubscribes: 0, permission: opts.permission };
      w.__push = rec;
      if (opts.unsupported) {
        delete w.PushManager;
        return;
      }
      Object.defineProperty(Notification, "permission", { configurable: true, get: () => rec.permission });
      Notification.requestPermission = async () => {
        rec.prompts++;
        rec.permission = opts.answer ?? "granted";
        return rec.permission;
      };
      let current: PushSubscription | null = null;
      const make = (key: BufferSource | null, reuse = false) => {
        // The same address across pages of this browser, like a real subscription.
        let endpoint = localStorage.getItem("e2e-push-endpoint");
        if (!endpoint || !reuse) endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem("e2e-push-endpoint", endpoint);
        const sub = {
          endpoint,
          expirationTime: null,
          options: { userVisibleOnly: true, applicationServerKey: key },
          toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: P256DH, auth: AUTH } }),
          unsubscribe: async () => {
            rec.unsubscribes++;
            current = null;
            return true;
          },
        };
        return sub as unknown as PushSubscription;
      };
      const pushManager = {
        getSubscription: async () => current,
        subscribe: async (o: PushSubscriptionOptionsInit) => {
          rec.subscribes++;
          const k = o.applicationServerKey;
          current = make(k instanceof Uint8Array ? (k.buffer as ArrayBuffer) : (k as BufferSource));
          return current;
        },
      };
      if (opts.subscribed) current = make(null, true);
      const reg = { scope: `${location.origin}/`, pushManager } as unknown as ServiceWorkerRegistration;
      Object.defineProperty(navigator.serviceWorker, "ready", { configurable: true, get: () => Promise.resolve(reg) });
      navigator.serviceWorker.getRegistration = async () => reg;
      w.__pushEndpoint = () => current?.endpoint ?? null;
    },
    [opts, P256DH, AUTH] as const,
  );
}

export const pushRecord = (page: { evaluate<T>(fn: () => T): Promise<T> }) =>
  page.evaluate(
    () => (window as unknown as { __push: { prompts: number; subscribes: number; unsubscribes: number } }).__push,
  );
