import { NextResponse, type NextRequest } from "next/server";

import { getServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-time bootstrap helper for first-time deploy when the Supabase
 * default-email rate limit is in the way.
 *
 * Usage:
 *
 *   1. Set env var ADMIN_BOOTSTRAP_SECRET to a long random string
 *      (e.g. `openssl rand -hex 32`) and redeploy.
 *   2. Visit:
 *        /api/setup/sign-me-in?secret=<that string>&email=<your admin email>
 *   3. Click the big link on the page that appears — it's a magic link
 *      URL generated server-side without sending any email, so it
 *      bypasses Supabase's 2/hour email rate limit entirely.
 *
 * Once Resend SMTP (Stage 3 of DEPLOY.md) is wired up and you've
 * signed in successfully via the normal /auth/sign-in flow at least
 * once, you can DELETE this file safely.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.ADMIN_BOOTSTRAP_SECRET;
  if (!expected) {
    return htmlPage(
      "Not configured",
      `<p>This endpoint requires <code>ADMIN_BOOTSTRAP_SECRET</code> to be set
       in environment variables. Add a long random value to Vercel and
       redeploy, then revisit this URL with <code>?secret=&lt;that value&gt;</code>.</p>`,
      503,
    );
  }

  const url = new URL(request.url);
  const secret = url.searchParams.get("secret") ?? "";
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();

  if (!secret || !timingSafeEqual(secret, expected)) {
    return htmlPage(
      "Unauthorized",
      `<p>The <code>?secret=</code> query parameter does not match
       <code>ADMIN_BOOTSTRAP_SECRET</code>.</p>`,
      401,
    );
  }
  if (!email) {
    return htmlPage(
      "Email required",
      `<p>Add <code>&amp;email=&lt;your admin email&gt;</code> to the URL.</p>`,
      400,
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return htmlPage(
      "App URL not set",
      `<p><code>NEXT_PUBLIC_APP_URL</code> must be set so the magic link
       can redirect back to this deployment.</p>`,
      500,
    );
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: appUrl },
  });

  if (error || !data?.properties?.action_link) {
    return htmlPage(
      "Could not generate link",
      `<p>${escapeHtml(
        error?.message ?? "Supabase returned no action_link.",
      )}</p>`,
      500,
    );
  }

  const link = data.properties.action_link;

  return htmlPage(
    "Sign in to your portal",
    `
      <p>Magic link generated for <strong>${escapeHtml(email)}</strong>.
         Click to sign in. This bypasses the Supabase email rate limit.</p>
      <p style="margin-top:24px">
        <a href="${escapeAttr(link)}" style="display:inline-block;padding:14px 22px;background:#22a4b5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
          Sign me in →
        </a>
      </p>
      <p style="margin-top:24px;color:#8a979c;font-size:12px">
        After you've signed in successfully, set up Resend SMTP
        (Stage 3 of DEPLOY.md) and delete
        <code>booking/app/api/setup/sign-me-in/route.ts</code> from
        the repo. This endpoint is for first-time bootstrap only.
      </p>
    `,
  );
}

function htmlPage(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="background:#0b0f10;color:#e8eef0;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center">
<div style="max-width:560px">
  <p style="color:#22a4b5;text-transform:uppercase;letter-spacing:0.2em;font-size:12px;margin:0">Pixel Blaster Setup</p>
  <h1 style="margin:8px 0 16px">${escapeHtml(title)}</h1>
  ${body}
</div></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
