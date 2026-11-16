/** Runs video/scripts/fixtures.ts (the app-importing part) in a child process. */
import { spawnSync } from "node:child_process";
import { fixturesEnv } from "./servers";

export function fixture<T = Record<string, unknown>>(command: string, ...args: string[]): T {
  const r = spawnSync(
    "pnpm",
    ["exec", "tsx", "--conditions=react-server", "video/scripts/fixtures.ts", command, ...args],
    { env: fixturesEnv(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  const line = r.stdout.split("\n").find((l) => l.startsWith("@@RESULT "));
  if (r.status !== 0 || !line) {
    throw new Error(`fixture ${command} failed:\n${r.stdout}\n${r.stderr}`);
  }
  return JSON.parse(line.slice("@@RESULT ".length)) as T;
}
