import { revalidateTag } from "next/cache";
import { connection } from "next/server";
import { sendTakedownEmail } from "@/server/email";
import { handleTakedown } from "@/server/takedown-route";

/** The site owner's takedown, for `pnpm content:hide|content:restore <link>` (src/server/takedown-route.ts). */
export async function POST(request: Request) {
  await connection();
  return handleTakedown(request, revalidateTag, sendTakedownEmail);
}
