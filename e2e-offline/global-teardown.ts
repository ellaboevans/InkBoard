import { stop } from "./server";

export default async function globalTeardown() {
  await stop();
}
