import { NextResponse, type NextRequest } from "next/server";

import { shouldHandoffAuthCode } from "@/lib/auth/auth-code-handoff";
import { supabaseSessionExpiryState } from "@/lib/auth/session-cookie-expiry";
import {
  getSupabaseAuthCookieBaseName,
  isSupabaseAuthCookieName,
} from "@/lib/auth/supabase-auth-cookie-family";
import { canonicalHostAction } from "@/lib/security/canonical-host";
import { verifyProductionProxyRequest } from "@/lib/security/production-proxy-attestation";

/**
 * Edge middleware.
 *
 * Responsibilities:
 *   1. If the request carries a `?code=...` query param (Supabase
 *      PKCE auth code from a magic link), forward it to
 *      /auth/callback so the session can be established.
 *   2. For protected paths (/admin, /portal), verify that a Supabase
 *      session cookie is present. The server-side auth helpers perform
 *      the real session, role, and organization checks.
 *
 * We deliberately do NOT import @supabase/ssr or @supabase/auth-js
 * here, because:
 *   - Those libraries pull in a state machine (initializePromise +
 *     lock acquisition) that's been observed to hang on Vercel's
 *     serverless runtime, producing 504 MIDDLEWARE_INVOCATION_TIMEOUT.
 *   - All we need at the edge is a cheap "is this cookie present?" check.
 *     An expired access token may still have a valid refresh token. Rejecting
 *     it here prevents @supabase/ssr from refreshing it and causes the UI to
 *     look signed in on public pages but signed out on protected pages.
 *
 * Security: the access_token is a JWT signed by Supabase. We don't
 * verify the signature here — if someone forges a cookie they'll
 * still be caught when a page's server component tries to read the
 * profiles table (RLS + real auth kicks in then). Middleware just
 * short-circuits obviously-unauthenticated requests so users aren't
 * bounced to /auth/sign-in on valid sessions.
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const canonicalOrigin = configuredCanonicalOrigin();
  const productionProxyHost =
    process.env.BOOKING_PROXY_UPSTREAM_HOST ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const trustedProductionProxy = await verifyProductionProxyRequest(
    request,
    process.env.BOOKING_PROXY_SHARED_SECRET,
    {
      canonicalHost: canonicalOrigin.hostname,
      productionProxyHost,
    },
  );
  const hostAction = canonicalHostAction({
    canonicalHost: canonicalOrigin.hostname,
    forwardedHost: request.headers.get("x-forwarded-host"),
    host: request.headers.get("host"),
    method: request.method,
    pathname: path,
    productionProxyHost,
    trustedProductionProxy,
    vercelEnvironment: process.env.VERCEL_ENV,
  });
  if (hostAction === "redirect") {
    const canonicalUrl = new URL(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      canonicalOrigin,
    );
    const redirectResponse = NextResponse.redirect(canonicalUrl, 307);
    redirectResponse.headers.set("Cache-Control", "no-store");
    return redirectResponse;
  }
  if (hostAction === "reject") {
    return NextResponse.json(
      { error: "Misdirected request." },
      {
        status: 421,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    "x-current-path",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  // Let Next's Server Action handler encode guarded redirects as
  // x-action-redirect. A raw middleware 307 is followed as a POST and breaks
  // the Action protocol. Host containment above still runs first.
  if (
    request.method === "POST" &&
    request.headers.get("next-action") !== null
  ) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // 1. Auth-code handoff. Any `?code=` on a non-callback, non-API path
  // gets funnelled through /auth/callback which handles the exchange.
  const authCode = request.nextUrl.searchParams.get("code");
  if (shouldHandoffAuthCode(path, Boolean(authCode))) {
    const callback = request.nextUrl.clone();
    callback.pathname = "/auth/callback";
    const next = path === "/" ? "/admin" : path;
    callback.searchParams.set("next", next);
    return NextResponse.redirect(callback);
  }

  // 2. Protected-path gate.
  const protectedPath =
    path.startsWith("/admin") || path.startsWith("/portal");

  if (!protectedPath) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (!hasSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/sign-in";
    url.searchParams.set("audience", path.startsWith("/admin") ? "company" : "realtor");
    url.searchParams.set("next", `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  if (
    request.method === "GET" &&
    supabaseSessionExpiryState(
      request.cookies.getAll(),
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ) === "near_expiry"
  ) {
    const refresh = new URL("/auth/refresh", canonicalOrigin);
    refresh.searchParams.set("next", `${path}${request.nextUrl.search}`);
    const response = NextResponse.redirect(refresh, 307);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

function configuredCanonicalOrigin(): URL {
  const fallback = new URL("https://pixelblastermedia.com");
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return fallback;

  try {
    const url = new URL(configured);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hostname.endsWith(".vercel.app")
    ) {
      return fallback;
    }
    return new URL(url.origin);
  } catch {
    return fallback;
  }
}

/**
 * Check whether the request carries the Supabase session cookie.
 *
 * Handles the two things @supabase/ssr v0.5+ does to the cookie:
 *   - `base64-` prefix + base64url encoding of the JSON session.
 *   - Chunking across `{name}.0`, `{name}.1`, etc. when the encoded
 *     value exceeds ~3180 bytes.
 */
function hasSessionCookie(request: NextRequest): boolean {
  const cookieName = getSupabaseAuthCookieBaseName(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  if (!cookieName) return false;

  return request.cookies
    .getAll()
    .some(
      (cookie) =>
        Boolean(cookie.value) &&
        isSupabaseAuthCookieName(cookie.name, cookieName),
    );
}

export const config = {
  // Host containment must also cover static and extension-suffixed paths.
  matcher: ["/:path*"],
};
