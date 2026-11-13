import "server-only";
import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z.url(),
    AUTH_SECRET: z
      .string()
      .min(32, "AUTH_SECRET must be at least 32 characters"),
    EDITOR_ALLOWLIST: z.string().optional().default(""),
    RESEND_API_KEY: z.string().optional().default(""),
    EMAIL_FROM: z.string().optional().default("InkBoard <onboarding@resend.dev>"),
    APP_URL: z.url().default("http://localhost:3000"),
    /**
     * How many proxies in front of the app append to X-Forwarded-For.
     * The client IP is taken that many entries from the right, because
     * everything further left is client-controlled. Vercel: 1.
     */
    /** Shared secret for /api/cron/cleanup (Vercel Cron sends it as a Bearer token). */
    CRON_SECRET: z
      .union([z.literal(""), z.string().min(32, "CRON_SECRET must be at least 32 characters")])
      .optional()
      .default(""),
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(10).default(1),
  })
  .superRefine((env, ctx) => {
    // Emails are always really sent, locally too: no key means no sign-in, so
    // fail at startup with a clear message instead. The only exceptions are
    // automated tests: Vitest mocks the email module, and the E2E server
    // records emails in E2E_OTP_OUTBOX (never in production).
    const automatedTest =
      env.NODE_ENV === "test" || (env.NODE_ENV !== "production" && Boolean(process.env.E2E_OTP_OUTBOX));
    if (!env.RESEND_API_KEY && !automatedTest) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "RESEND_API_KEY is required to send sign-in emails (set it in .env.local; see docs/DEPLOY.md)",
      });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/**
 * Validated server environment. Parsed lazily so that `next build` does not
 * require runtime secrets, but any request that needs them fails loudly.
 */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: re-read process.env on the next env() call. */
export function resetEnvCache(): void {
  cached = undefined;
}
