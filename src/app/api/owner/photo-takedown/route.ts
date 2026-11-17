import { revalidateTag } from "next/cache";
import { connection } from "next/server";
import { handlePhotoTakedown } from "@/server/photo-takedown-route";

/** The site owner's photo takedown, for `pnpm photo:remove <author-slug>` (src/server/photo-takedown-route.ts). */
export async function POST(request: Request) {
  await connection();
  return handlePhotoTakedown(request, revalidateTag);
}
