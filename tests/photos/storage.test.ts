import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { photoStorageConfig } from "@/env";
import { localStorage } from "@/server/storage/local";
import { r2Storage } from "@/server/storage/r2";
import { StorageError } from "@/server/storage/types";

const CONFIG = {
  accountId: "0123456789abcdef0123456789abcdef",
  accessKeyId: "AKIDEXAMPLE0123",
  secretAccessKey: "SECRET-never-printed-0123456789",
  bucket: "inkboard-photos",
};

type Call = { url: string; method: string; headers: Headers; body: Uint8Array | null };

/** A fake R2: answers from `respond`, recording each signed request. */
function mockR2(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const req = input as Request;
    const body = req.body ? new Uint8Array(await req.arrayBuffer()) : null;
    const call = { url: req.url, method: req.method, headers: req.headers, body };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, storage: r2Storage(CONFIG, fetchImpl) };
}

const s3Error = (status: number, code: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>x</Message></Error>`, { status });

describe("the local driver (Phase 22)", () => {
  let dir: string;
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it("puts, gets, lists and deletes real files, and tidies empty folders", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "inkboard-storage-"));
    const s = localStorage(dir);
    await s.put("photos/AAAAAAAAAAAAAAAAAAAAAA/96.webp", new Uint8Array([1, 2, 3]), "image/webp");
    await s.put("photos/AAAAAAAAAAAAAAAAAAAAAA/512.jpg", new Uint8Array([4]), "image/jpeg");
    expect(await s.get("photos/AAAAAAAAAAAAAAAAAAAAAA/96.webp")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await s.get("photos/BBBBBBBBBBBBBBBBBBBBBB/96.webp")).toBeNull();
    const listed = await s.list("photos/");
    expect(listed.map((o) => o.key).sort()).toEqual(["photos/AAAAAAAAAAAAAAAAAAAAAA/512.jpg", "photos/AAAAAAAAAAAAAAAAAAAAAA/96.webp"]);
    expect(listed[0].lastModified).toBeInstanceOf(Date);
    await s.delete("photos/AAAAAAAAAAAAAAAAAAAAAA/96.webp");
    await s.delete("photos/AAAAAAAAAAAAAAAAAAAAAA/512.jpg");
    await s.delete("photos/AAAAAAAAAAAAAAAAAAAAAA/512.jpg"); // missing: fine
    expect(await s.get("photos/AAAAAAAAAAAAAAAAAAAAAA/96.webp")).toBeNull();
    expect(await readdir(path.join(dir, "photos"))).toEqual([]);
  });

  it("refuses keys that could leave its folder", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "inkboard-storage-"));
    const s = localStorage(dir);
    for (const key of ["../x.webp", "photos/../../etc/passwd", "/abs/x.jpg", "photos/a b/x.jpg", "photos//x.jpg"]) {
      await expect(s.put(key, new Uint8Array([1]), "x"), key).rejects.toBeInstanceOf(StorageError);
    }
  });
});

describe("the R2 driver, against a mock (Phase 22)", () => {
  it("signs path-style S3 requests to the account's R2 endpoint", async () => {
    const { calls, storage } = mockR2(() => new Response(null, { status: 200 }));
    await storage.put("photos/AAAAAAAAAAAAAAAAAAAAAA/96.webp", new Uint8Array([9, 8, 7]), "image/webp");
    const [put] = calls;
    expect(put.method).toBe("PUT");
    expect(put.url).toBe(`https://${CONFIG.accountId}.r2.cloudflarestorage.com/inkboard-photos/photos/AAAAAAAAAAAAAAAAAAAAAA/96.webp`);
    expect(put.headers.get("content-type")).toBe("image/webp");
    expect(put.body).toEqual(new Uint8Array([9, 8, 7]));
    const auth = put.headers.get("authorization")!;
    expect(auth).toMatch(new RegExp(`^AWS4-HMAC-SHA256 Credential=${CONFIG.accessKeyId}/\\d{8}/auto/s3/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$`));
    expect(put.headers.get("x-amz-content-sha256")).toMatch(/^[0-9a-f]{64}$|^UNSIGNED-PAYLOAD$/);
    // The secret itself never travels.
    for (const [, v] of put.headers) expect(v).not.toContain(CONFIG.secretAccessKey);
  });

  it("gets bytes, and a missing object is null", async () => {
    const { storage } = mockR2((c) => (c.url.endsWith("/96.webp") ? new Response(new Uint8Array([5, 6])) : s3Error(404, "NoSuchKey")));
    expect(await storage.get("photos/AAAAAAAAAAAAAAAAAAAAAA/96.webp")).toEqual(new Uint8Array([5, 6]));
    expect(await storage.get("photos/AAAAAAAAAAAAAAAAAAAAAA/192.webp")).toBeNull();
  });

  it("deletes (204, and 404 is fine)", async () => {
    const { calls, storage } = mockR2((c) => new Response(null, { status: c.url.includes("gone") ? 404 : 204 }));
    await storage.delete("photos/AAAAAAAAAAAAAAAAAAAAAA/96.webp");
    await storage.delete("photos/gone/96.webp");
    expect(calls.map((c) => c.method)).toEqual(["DELETE", "DELETE"]);
  });

  it("lists every page (ListObjectsV2 with continuation tokens)", async () => {
    const page = (keys: string[], next?: string) =>
      new Response(
        `<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key><LastModified>2026-11-01T10:00:00.000Z</LastModified></Contents>`).join("")}<IsTruncated>${next ? "true" : "false"}</IsTruncated>${next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ""}</ListBucketResult>`,
      );
    const { calls, storage } = mockR2((c) => (new URL(c.url).searchParams.get("continuation-token") === "t&2" ? page(["photos/b/96.webp"]) : page(["photos/a/96.webp"], "t&amp;2")));
    const listed = await storage.list("photos/");
    expect(listed).toEqual([
      { key: "photos/a/96.webp", lastModified: new Date("2026-11-01T10:00:00.000Z") },
      { key: "photos/b/96.webp", lastModified: new Date("2026-11-01T10:00:00.000Z") },
    ]);
    expect(new URL(calls[0].url).searchParams.get("list-type")).toBe("2");
    expect(new URL(calls[0].url).searchParams.get("prefix")).toBe("photos/");
  });

  it("names what's wrong (wrong key, missing bucket, permissions) without the secret", async () => {
    const cases: [Response, StorageError["code"]][] = [
      [s3Error(403, "InvalidAccessKeyId"), "bad_credentials"],
      [s3Error(403, "SignatureDoesNotMatch"), "bad_credentials"],
      [s3Error(404, "NoSuchBucket"), "no_bucket"],
      [s3Error(403, "AccessDenied"), "access_denied"],
      [s3Error(500, "InternalError"), "unexpected"],
    ];
    for (const [response, code] of cases) {
      const { storage } = mockR2(() => response.clone());
      const err = await storage.put("photos/a/96.webp", new Uint8Array([1]), "image/webp").catch((e) => e);
      expect(err, code).toBeInstanceOf(StorageError);
      expect(err.code).toBe(code);
      expect(err.message).not.toContain(CONFIG.secretAccessKey);
      expect(err.message).not.toContain(CONFIG.accessKeyId);
    }
    // A missing bucket is an error on get too, not a missing object.
    const { storage } = mockR2(() => s3Error(404, "NoSuchBucket"));
    await expect(storage.get("photos/a/96.webp")).rejects.toMatchObject({ code: "no_bucket" });
    // Network failures.
    const down = r2Storage(CONFIG, (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    await expect(down.get("photos/a/96.webp")).rejects.toMatchObject({ code: "network" });
  });
});

describe("which driver (photoStorageConfig, Phase 22)", () => {
  const r2 = { R2_ACCOUNT_ID: CONFIG.accountId, R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" };

  it("R2 when all four variables are set, anywhere", () => {
    expect(photoStorageConfig({ NODE_ENV: "production", VERCEL: "1", ...r2 })).toEqual({ driver: "r2", accountId: CONFIG.accountId, accessKeyId: "k", secretAccessKey: "s", bucket: "b" });
    expect(photoStorageConfig({ NODE_ENV: "development", ...r2 }).driver).toBe("r2");
  });

  it("the local folder in development and tests, or when PHOTO_STORAGE_DIR is set off Vercel", () => {
    expect(photoStorageConfig({ NODE_ENV: "development" })).toEqual({ driver: "local", dir: ".storage/dev" });
    expect(photoStorageConfig({ NODE_ENV: "test", PHOTO_STORAGE_DIR: "/tmp/x" })).toEqual({ driver: "local", dir: "/tmp/x" });
    expect(photoStorageConfig({ NODE_ENV: "production", PHOTO_STORAGE_DIR: ".storage/offline" })).toEqual({ driver: "local", dir: ".storage/offline" });
  });

  it("production without R2 is not configured, with a message saying what to set (the build doesn't call this)", () => {
    const none = photoStorageConfig({ NODE_ENV: "production" });
    expect(none).toMatchObject({ driver: "none" });
    expect(none.driver === "none" && none.reason).toMatch(/R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET/);
    // Never a disk on Vercel, even with the folder variable.
    expect(photoStorageConfig({ NODE_ENV: "production", VERCEL: "1", PHOTO_STORAGE_DIR: "/tmp" }).driver).toBe("none");
  });

  it("partly set, or a malformed account id, says exactly what's wrong", () => {
    const partial = photoStorageConfig({ NODE_ENV: "production", R2_ACCOUNT_ID: CONFIG.accountId, R2_BUCKET: "b" });
    expect(partial.driver === "none" && partial.reason).toBe("R2 is only partly configured: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY are missing");
    const bad = photoStorageConfig({ NODE_ENV: "production", ...r2, R2_ACCOUNT_ID: "my-account" });
    expect(bad.driver === "none" && bad.reason).toMatch(/32-character account ID/);
  });
});
