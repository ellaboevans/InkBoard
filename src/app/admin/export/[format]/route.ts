import { requireOnboardedEditor } from "@/server/auth/dal";
import { allowExport, loadEditorExport } from "@/server/export";
import {
  EXPORT_CONTENT_TYPES,
  exportFileName,
  exportToJson,
  exportToMarkdown,
  type ExportFormat,
} from "@/lib/export-format";
import { siteUrl } from "@/lib/site";

/**
 * GET /admin/export/markdown and /admin/export/json: the signed-in editor's
 * own poems as a download (docs/PLAN.md, Phase 17). Re-authorises through
 * the DAL (signed out → /sign-in), so only that editor's data can appear.
 * No step-up and no email (decided); rate-limited per editor.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ format: string }> }) {
  const { format } = await params;
  if (format !== "markdown" && format !== "json") return new Response("Not found", { status: 404 });
  const editor = await requireOnboardedEditor();

  const limit = await allowExport(editor.id);
  if (!limit.allowed) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfter / 60));
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Too many downloads</title><p>You've downloaded your poems often in the last hour. Try again in ${minutes} min.</p><p><a href="/admin/settings">Back to settings</a></p>`,
      {
        status: 429,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Retry-After": String(limit.retryAfter),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const now = new Date();
  const data = await loadEditorExport(editor.id, { site: siteUrl().origin, now });
  if (!data) return new Response("Not found", { status: 404 });
  const kind = format as ExportFormat;
  const body = kind === "markdown" ? exportToMarkdown(data) : exportToJson(data);
  return new Response(body, {
    headers: {
      "Content-Type": EXPORT_CONTENT_TYPES[kind],
      "Content-Disposition": `attachment; filename="${exportFileName(data.profile.slug, kind, now)}"`,
      // Private poems and drafts: never kept by the browser or anything in between.
      "Cache-Control": "no-store",
    },
  });
}
