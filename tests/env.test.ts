import { afterEach, describe, expect, it } from "vitest";
import { env, resetEnvCache } from "@/env";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

function load(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
  return () => env();
}

describe("RESEND_API_KEY: emails are always really sent", () => {
  it("is required in local development (no printing codes instead)", () => {
    expect(load({ NODE_ENV: "development", RESEND_API_KEY: "", E2E_OTP_OUTBOX: undefined })).toThrow(/RESEND_API_KEY is required/);
  });

  it("is required in production, even if an E2E outbox is configured", () => {
    expect(load({ NODE_ENV: "production", RESEND_API_KEY: "", E2E_OTP_OUTBOX: "/tmp/outbox" })).toThrow(/RESEND_API_KEY is required/);
  });

  it("can be omitted only by the automated E2E server and the test runner", () => {
    expect(load({ NODE_ENV: "development", RESEND_API_KEY: "", E2E_OTP_OUTBOX: "/tmp/outbox" })().RESEND_API_KEY).toBe("");
    expect(load({ NODE_ENV: "test", RESEND_API_KEY: "", E2E_OTP_OUTBOX: undefined })().RESEND_API_KEY).toBe("");
  });

  it("is accepted when set", () => {
    expect(load({ NODE_ENV: "development", RESEND_API_KEY: "re_test_key", E2E_OTP_OUTBOX: undefined })().RESEND_API_KEY).toBe("re_test_key");
  });
});
