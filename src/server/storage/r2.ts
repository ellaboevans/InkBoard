import { AwsClient } from "aws4fetch";
import { assertKey, StorageError, type ObjectStorage } from "./types";

/*
 * The R2 driver: Cloudflare R2's S3-compatible API, signed with SigV4 by
 * aws4fetch (one small dependency-free file over fetch; Cloudflare's own R2
 * docs use it). The AWS SDK would add megabytes to the function for four calls.
 *
 * Path-style URLs: https://<account>.r2.cloudflarestorage.com/<bucket>/<key>.
 * Errors become StorageError codes the storage check can name (wrong key,
 * missing bucket, permissions); messages never include a secret.
 */

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

const TIMEOUT_MS = 10_000;

function s3Code(xml: string): string | null {
  return /<Code>([^<]+)<\/Code>/.exec(xml)?.[1] ?? null;
}

async function failure(res: Response, op: string): Promise<StorageError> {
  const code = s3Code(await res.text().catch(() => ""));
  const what = `R2 ${op} failed (HTTP ${res.status}${code ? `, ${code}` : ""})`;
  if (code === "NoSuchBucket") return new StorageError("no_bucket", `${what}: the bucket doesn't exist (check R2_BUCKET)`, res.status);
  if (code === "InvalidAccessKeyId" || code === "SignatureDoesNotMatch" || res.status === 401) {
    return new StorageError("bad_credentials", `${what}: the access key or secret is wrong (check R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY)`, res.status);
  }
  if (res.status === 403) {
    return new StorageError("access_denied", `${what}: the token isn't allowed to do this (it needs Object Read & Write on this bucket)`, res.status);
  }
  return new StorageError("unexpected", what, res.status);
}

export function r2Storage(config: R2Config, fetchImpl: typeof fetch = fetch): ObjectStorage {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
    retries: 2,
  });
  const base = `https://${config.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(config.bucket)}`;
  const urlFor = (key: string) => {
    assertKey(key);
    return `${base}/${key}`;
  };

  async function send(url: string, init: RequestInit, op: string): Promise<Response> {
    const signed = await client.sign(url, init);
    try {
      return await fetchImpl(signed, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new StorageError("network", `R2 ${op} failed: ${(err as Error).name === "TimeoutError" ? "timed out" : "couldn't reach R2 (check R2_ACCOUNT_ID)"}`);
    }
  }

  return {
    kind: "r2",
    async put(key, body, contentType) {
      const res = await send(
        urlFor(key),
        { method: "PUT", body: body as BodyInit, headers: { "Content-Type": contentType, "Content-Length": String(body.byteLength) } },
        "put",
      );
      if (!res.ok) throw await failure(res, "put");
    },
    async get(key) {
      const res = await send(urlFor(key), { method: "GET" }, "get");
      if (res.status === 404) {
        const err = await failure(res, "get");
        if (err.code === "no_bucket") throw err;
        return null;
      }
      if (!res.ok) throw await failure(res, "get");
      return new Uint8Array(await res.arrayBuffer());
    },
    async delete(key) {
      const res = await send(urlFor(key), { method: "DELETE" }, "delete");
      // S3 answers 204 for a missing key too.
      if (!res.ok && res.status !== 404) throw await failure(res, "delete");
    },
    async list(prefix) {
      const out: { key: string; lastModified: Date }[] = [];
      let token: string | null = null;
      do {
        const q = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000" });
        if (token) q.set("continuation-token", token);
        const res = await send(`${base}?${q}`, { method: "GET" }, "list");
        if (!res.ok) throw await failure(res, "list");
        const xml = await res.text();
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const key = /<Key>([^<]+)<\/Key>/.exec(m[1])?.[1];
          const modified = /<LastModified>([^<]+)<\/LastModified>/.exec(m[1])?.[1];
          if (key && modified) out.push({ key: decodeXml(key), lastModified: new Date(modified) });
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null)
          : null;
        if (token) token = decodeXml(token);
      } while (token);
      return out;
    },
  };
}

function decodeXml(s: string) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
