import { NextResponse, type NextRequest } from "next/server";

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
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    "x-current-path",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  // 1. Auth-code handoff. Any `?code=` on a non-callback, non-API path
  // gets funnelled through /auth/callback which handles the exchange.
  const authCode = request.nextUrl.searchParams.get("code");
  if (
    authCode &&
    !path.startsWith("/auth/callback") &&
    !path.startsWith("/api/")
  ) {
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
    url.searchParams.set("next", `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return false;

  let projectRef: string;
  try {
    projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  } catch {
    return false;
  }
  const cookieName = `sb-${projectRef}-auth-token`;

  // The cookie may be a single value or split into numbered chunks.
  const primary = request.cookies.get(cookieName)?.value;
  if (primary) return true;

  // A chunked session is only useful when the first chunk exists. The server
  // auth helper will reject malformed or incomplete values after this gate.
  return Boolean(request.cookies.get(`${cookieName}.0`)?.value);
}

export const config = {
  // Run on everything except static assets, the favicon, and image
  // optimization output.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp)$).*)",
  ],
};
