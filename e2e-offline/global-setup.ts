import { build, runFixtures, start, stop } from "./server";

export default async function globalSetup() {
  await stop(); // a server left over from an interrupted run
  runFixtures(); // before the build: the board is prerendered with these poems
  const buildId = `e2e-${Date.now().toString(36)}`;
  build(buildId);
  await start(buildId);
}
