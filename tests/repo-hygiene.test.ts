import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// .gitignore keeps env files out, but `git add -f` bypasses it. These checks
// fail the test suite if a real env file (with secrets) is ever tracked.
const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const isEnvFile = (path: string) => {
  const name = path.split("/").pop()!;
  return name.startsWith(".env") || name.endsWith(".env") || name.endsWith(".env.local") || name === ".envrc";
};

describe("env files are never committed", () => {
  it("tracks no env file except the .env.example template", () => {
    expect(tracked.filter(isEnvFile)).toEqual([".env.example"]);
  });

  it(".gitignore ignores real env files", () => {
    for (const path of [".env", ".env.local", ".env.production", ".env.development.local", "nested/dir/.env.local", "prod.env", ".envrc"]) {
      const ignored = (() => {
        try {
          execFileSync("git", ["check-ignore", "-q", path]);
          return true;
        } catch {
          return false;
        }
      })();
      expect(ignored, path).toBe(true);
    }
  });

  it("the .env.example template contains only placeholders", () => {
    const values = Object.fromEntries(
      readFileSync(".env.example", "utf8")
        .split("\n")
        .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")]),
    );
    expect(values.RESEND_API_KEY).toBe("");
    expect(values.CRON_SECRET ?? "").toBe("");
    expect(values.AUTH_SECRET).toMatch(/change-me/);
    for (const [key, value] of Object.entries(values)) {
      expect(value, key).not.toMatch(/\bre_[A-Za-z0-9_]{16,}/); // a Resend API key
    }
  });
});
