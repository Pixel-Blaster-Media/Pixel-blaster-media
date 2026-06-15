import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware.
 *
 * Responsibilities:
 *   1. If the request carries a `?code=...` query param (Supabase
 *      PKCE auth code from a magic link), forward it to
 *      /auth/callback so the session can be established.
 *   2. For protected paths (/admin, /portal), verify the caller has
 *      an unexpired session by reading the Supabase session cookie
 *      directly and decoding the access_token JWT's `exp` claim.
 *
 * We deliberately do NOT import @supabase/ssr or @supabase/auth-js
 * here, because:
 *   - Those libraries pull in a state machine (initializePromise +
 *     lock acquisition) that's been observed to hang on Vercel's
 *     serverless runtime, producing 504 MIDDLEWARE_INVOCATION_TIMEOUT.
 *   - All we need at the edge is a cheap "is this cookie present and
 *     not expired?" check. The server-side library with its cookie
 *     adapter is used for the heavier read/write paths (bridge,
 *     requireAdmin, etc) where a 1-2 second latency is fine.
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

  const sessionIsValid = isSessionCookieValid(request);
  if (!sessionIsValid) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/sign-in";
    url.searchParams.set("next", `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

/**
 * Read the Supabase session cookie directly and check whether its
 * access_token is valid (present and not expired).
 *
 * Handles the two things @supabase/ssr v0.5+ does to the cookie:
 *   - `base64-` prefix + base64url encoding of the JSON session.
 *   - Chunking across `{name}.0`, `{name}.1`, etc. when the encoded
 *     value exceeds ~3180 bytes.
 */
function isSessionCookieValid(request: NextRequest): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return false;

  let projectRef: string;
  try {
    projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  } catch {
    return false;
  }
  const cookieName = `sb-${projectRef}-auth-token`;

  // Assemble the cookie value (may be a single cookie or chunked).
  const primary = request.cookies.get(cookieName)?.value;
  let raw: string | null = null;
  if (primary) {
    raw = primary;
  } else {
    const parts: string[] = [];
    for (let i = 0; ; i++) {
      const chunk = request.cookies.get(`${cookieName}.${i}`)?.value;
      if (!chunk) break;
      parts.push(chunk);
    }
    if (parts.length > 0) raw = parts.join("");
  }

  if (!raw) return false;

  // Strip @supabase/ssr's `base64-` prefix and decode base64url to JSON.
  let json: string;
  try {
    if (raw.startsWith("base64-")) {
      const b64 = raw.slice("base64-".length);
      json = Buffer.from(b64, "base64url").toString("utf8");
    } else {
      json = raw;
    }
  } catch {
    return false;
  }

  let session: { access_token?: string; expires_at?: number };
  try {
    session = JSON.parse(json);
  } catch {
    return false;
  }

  if (!session.access_token) return false;

  // Trust the top-level expires_at if present, otherwise pull it from
  // the JWT payload itself. Treat <30s-remaining as expired so we
  // don't hand pages a token that'll die mid-render.
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expSeconds =
    session.expires_at ?? extractExpFromJwt(session.access_token);
  if (!expSeconds) return false;
  return expSeconds > nowSeconds + 30;
}

function extractExpFromJwt(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export const config = {
  // Run on everything except static assets, the favicon, and image
  // optimization output.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp)$).*)",
  ],
};
