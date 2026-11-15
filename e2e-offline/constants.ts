import path from "node:path";

/** Shared by the offline E2E config, its setup and the specs (no app imports here). */
export const OFFLINE_PORT = Number(process.env.OFFLINE_E2E_PORT ?? 3177);
export const OFFLINE_BASE_URL = `http://localhost:${OFFLINE_PORT}`;
export const OFFLINE_DATABASE_URL =
  process.env.OFFLINE_E2E_DATABASE_URL ?? "postgresql://localhost:5432/poemhub_e2e_offline";
export const OFFLINE_DIST_DIR = ".next-offline";
export const FIXTURES_FILE = path.resolve("test-results/offline-fixtures.json");
export const SERVER_PID_FILE = path.resolve("test-results/offline-server.pid");
export const PRIVATE_PASSWORD = "lanternlight1";
export const PRIVATE_LINE = "your handwriting leans toward me still";
