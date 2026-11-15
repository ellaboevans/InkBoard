import { INSTALL_CAPTURE_SCRIPT } from "@/lib/install-nudge";

/**
 * The install nudge's `beforeinstallprompt` catcher (docs/PLAN.md, Phase 15),
 * loaded by the root layout as `<script async src="/install-capture.js">`.
 * A React "resource" script: hoisted into <head> on the server and never
 * re-created as a raw <script> on the client (which React warns about).
 * Prerendered; same origin, so the CSP needs no change.
 */
export function GET() {
  return new Response(INSTALL_CAPTURE_SCRIPT, {
    headers: { "Content-Type": "text/javascript; charset=utf-8" },
  });
}
