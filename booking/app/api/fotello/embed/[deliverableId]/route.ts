import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/auth/require-user";
import { getFreshGalleryUrl } from "@/lib/integrations/fotello/sync";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Iframe proxy for Fotello galleries.
 *
 *   <iframe src="/api/fotello/embed/{deliverableId}">
 *
 * Flow:
 *   1. Require the viewer to be signed in (so we don't leak gallery
 *      URLs to anyone with the link).
 *   2. Check the viewer owns (or admins) the property attached to this
 *      deliverable — RLS re-asserts this server-side.
 *   3. Use the sync helper to return a fresh gallery URL, refreshing
 *      from Fotello when the cached one is near expiry.
 *   4. 302 redirect the iframe straight to Fotello's gallery page.
 *
 * Fotello URLs leak in the network tab once the browser follows the
 * redirect — that's unavoidable for an iframe. The point of the proxy
 * is not URL secrecy, it's session-gated access + auto-refresh.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ deliverableId: string }> },
) {
  const user = await requireUser();
  const { deliverableId } = await ctx.params;

  const supabase = await getServerSupabase();
  // RLS lets realtors see only their own deliverables; admins see all.
  // If the deliverable doesn't surface, 404 regardless of why.
  const { data: deliverable } = await supabase
    .from("deliverables")
    .select("id, source, type")
    .eq("id", deliverableId)
    .maybeSingle<{ id: string; source: string; type: string }>();

  if (!deliverable) {
    return notFoundPage("This photo gallery doesn't exist or you don't have access.");
  }
  if (deliverable.source !== "fotello") {
    return notFoundPage("This deliverable isn't a Fotello gallery.");
  }

  const fresh = await getFreshGalleryUrl(deliverable.id);

  if (fresh.status && fresh.status !== "completed") {
    return statusPage(fresh.status);
  }
  if (!fresh.url) {
    return statusPage(fresh.error ?? "Gallery URL unavailable.");
  }

  // Tiny audit log — useful when debugging expired-URL issues in production.
  console.info(
    `[fotello.embed] user=${user.userId} deliverable=${deliverable.id} served fresh URL`,
  );

  return NextResponse.redirect(fresh.url, 302);
}

function statusPage(message: string): NextResponse {
  const body = `<!doctype html>
<html><head><meta charset="utf-8"><title>Photos</title>
<style>body{background:#0b0f10;color:#e8eef0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:20px}</style>
</head><body><div>
<p style="color:#22a4b5;text-transform:uppercase;letter-spacing:0.2em;font-size:12px">Photos</p>
<p style="margin-top:12px">${escapeHtml(message)}</p>
</div></body></html>`;
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function notFoundPage(message: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html><body style="font-family:system-ui;padding:40px;background:#0b0f10;color:#e8eef0;text-align:center">${escapeHtml(message)}</body></html>`,
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
