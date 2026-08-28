import {
  createChunks,
  DEFAULT_COOKIE_OPTIONS,
  stringToBase64URL,
  type CookieOptions,
} from "@supabase/ssr";
import type { Session } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { safeLoginRequestedPath } from "@/lib/auth/account-destination";
import { createBoundedSupabaseAuthFetch } from "@/lib/auth/bounded-supabase-auth-fetch";
import {
  SUPABASE_SESSION_COOKIE_MAX_ENCODED_LENGTH,
  SUPABASE_SESSION_REFRESH_SKEW_SECONDS,
  supabaseSessionRefreshHint,
} from "@/lib/auth/session-cookie-expiry";
import {
  getPresentSupabaseAuthCookieNames,
  getSupabaseAuthCookieBaseName,
} from "@/lib/auth/supabase-auth-cookie-family";
import { parseVerifiedAccessTokenClaims } from "@/lib/auth/verified-access-token";
import { publicRedirectOrigin } from "@/lib/security/canonical-app-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CookieMutation = {
  name: string;
  value: string;
  options: CookieOptions;
};

type TokenExchangeFailure = "unavailable" | "terminal";

/**
 * Rotates a near-expiry Supabase session in a cookie-mutable Route Handler.
 * The route owns exactly one direct token exchange. It never enters auth-js's
 * refreshSession() path, where a threshold crossing can trigger an implicit
 * refresh followed by a second explicit rotation. The destination RSC still
 * performs authoritative auth.getUser() verification before returning data.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const redirectOrigin = publicRedirectOrigin(url);
  const next = safeRefreshDestination(url.searchParams.get("next"));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return noStoreRedirect(new URL("/auth/access-unavailable", redirectOrigin));
  }

  const cookies = request.cookies.getAll();
  const hint = supabaseSessionRefreshHint(cookies, supabaseUrl);
  if (hint.state === "fresh") {
    // Another queued handoff may have arrived after an earlier response already
    // rotated the browser cookie. Continue without rotating that valid session.
    return noStoreRedirect(new URL(next, redirectOrigin));
  }
  if (hint.state === "missing") {
    return noStoreRedirect(signInDestination(redirectOrigin, next));
  }
  if (hint.state === "unreadable" || !hint.refreshToken) {
    return responseWithCookies(
      noStoreRedirect(signInDestination(redirectOrigin, next)),
      clearSessionCookieMutations(cookies, supabaseUrl),
    );
  }

  let failureKind: TokenExchangeFailure | null = null;
  const authFetch = createBoundedSupabaseAuthFetch(
    supabaseUrl,
    globalThis.fetch,
    {
      onTokenExchangeFailure(kind) {
        failureKind = kind;
      },
    },
  );

  let tokenResponse: Response;
  try {
    tokenResponse = await authFetch(
      `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${anonKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: hint.refreshToken }),
        cache: "no-store",
      },
    );
  } catch {
    return noStoreRedirect(new URL("/auth/access-unavailable", redirectOrigin));
  }

  if (!tokenResponse.ok) {
    if (failureKind !== "terminal") {
      return noStoreRedirect(new URL("/auth/access-unavailable", redirectOrigin));
    }
    // Refresh-token rejection can be the losing half of a concurrent rotation.
    // Fail closed without any cookie mutation: unlike a deletion header, an
    // inert redirect cannot erase a winner regardless of response order.
    return noStoreRedirect(signInDestination(redirectOrigin, next));
  }

  let session: Session | null = null;
  try {
    session = validatedSession(await tokenResponse.json());
  } catch {
    // A malformed successful provider response is an availability failure, not
    // proof that the browser's existing refresh credential is terminal.
  }
  if (!session) {
    return noStoreRedirect(new URL("/auth/access-unavailable", redirectOrigin));
  }

  const cookieMutations = refreshedSessionCookieMutations(
    cookies,
    supabaseUrl,
    session,
  );
  if (!cookieMutations) {
    return noStoreRedirect(new URL("/auth/access-unavailable", redirectOrigin));
  }
  return responseWithCookies(
    noStoreRedirect(new URL(next, redirectOrigin)),
    cookieMutations,
  );
}

function validatedSession(value: unknown): Session | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const accessToken = candidate.access_token;
  const refreshToken = candidate.refresh_token;
  const tokenType = candidate.token_type;
  const expiresIn = candidate.expires_in;
  const user = candidate.user;
  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    accessToken.length > 16_384 ||
    typeof refreshToken !== "string" ||
    refreshToken.length === 0 ||
    refreshToken.length > 16_384 ||
    typeof tokenType !== "string" ||
    tokenType.toLowerCase() !== "bearer" ||
    !Number.isSafeInteger(expiresIn) ||
    (expiresIn as number) <= 0 ||
    !user ||
    typeof user !== "object" ||
    Array.isArray(user) ||
    typeof (user as Record<string, unknown>).id !== "string" ||
    (user as Record<string, unknown>).id === "" ||
    ((user as Record<string, unknown>).id as string).length > 256
  ) {
    return null;
  }

  // This is transport-shape validation only, never authorization. The protected
  // destination performs the one required authoritative /auth/v1/user request
  // with this exact persisted bearer before rendering protected data.
  const nowSeconds = Math.floor(Date.now() / 1_000);
  let claims;
  try {
    claims = parseVerifiedAccessTokenClaims(
      accessToken,
      (user as Record<string, unknown>).id as string,
      nowSeconds,
    );
  } catch {
    return null;
  }
  if (claims.exp <= nowSeconds + SUPABASE_SESSION_REFRESH_SKEW_SECONDS) {
    return null;
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer" as const,
    expires_in: claims.exp - nowSeconds,
    expires_at: claims.exp,
    user: user as Session["user"],
    ...(typeof candidate.provider_token === "string"
      ? { provider_token: candidate.provider_token }
      : {}),
    ...(typeof candidate.provider_refresh_token === "string"
      ? { provider_refresh_token: candidate.provider_refresh_token }
      : {}),
  };
}

function authCookieName(supabaseUrl: string): string {
  const cookieName = getSupabaseAuthCookieBaseName(supabaseUrl);
  if (!cookieName) throw new Error("Invalid Supabase authentication URL.");
  return cookieName;
}

function productionCookieOptions(maxAge: number): CookieOptions {
  return {
    ...DEFAULT_COOKIE_OPTIONS,
    secure: process.env.NODE_ENV === "production",
    maxAge,
  };
}

function clearSessionCookieMutations(
  cookies: readonly { name: string; value: string }[],
  supabaseUrl: string,
): CookieMutation[] {
  const cookieName = authCookieName(supabaseUrl);
  return getPresentSupabaseAuthCookieNames(cookies, cookieName).map(
    (presentCookieName) => ({
      name: presentCookieName,
      value: "",
      options: productionCookieOptions(0),
    }),
  );
}

function refreshedSessionCookieMutations(
  cookies: readonly { name: string; value: string }[],
  supabaseUrl: string,
  session: Session,
): CookieMutation[] | null {
  const cookieName = authCookieName(supabaseUrl);
  const encoded = `base64-${stringToBase64URL(JSON.stringify(session))}`;
  if (encoded.length > SUPABASE_SESSION_COOKIE_MAX_ENCODED_LENGTH) {
    return null;
  }
  const chunks = createChunks(cookieName, encoded);
  const chunkNames = new Set(chunks.map((chunk) => chunk.name));
  const removals = getPresentSupabaseAuthCookieNames(cookies, cookieName)
    .filter((presentCookieName) => !chunkNames.has(presentCookieName))
    .map((presentCookieName) => ({
      name: presentCookieName,
      value: "",
      options: productionCookieOptions(0),
    }));
  const writes = chunks.map((chunk) => ({
    ...chunk,
    options: productionCookieOptions(400 * 24 * 60 * 60),
  }));
  return [...removals, ...writes];
}

function isRealtorDestination(path: string): boolean {
  return (
    path === "/portal" ||
    path.startsWith("/portal/") ||
    path.startsWith("/portal?")
  );
}

function safeRefreshDestination(requestedPath: string | null): string {
  if (requestedPath === "/auth/reset/confirm") return requestedPath;
  return safeLoginRequestedPath(
    requestedPath && isRealtorDestination(requestedPath) ? "realtor" : "company",
    requestedPath,
  );
}

function signInDestination(redirectOrigin: URL, next: string): URL {
  const destination = new URL("/auth/sign-in", redirectOrigin);
  destination.searchParams.set(
    "audience",
    isRealtorDestination(next) ? "realtor" : "company",
  );
  destination.searchParams.set("next", next);
  return destination;
}

function noStoreRedirect(destination: URL): NextResponse {
  const response = NextResponse.redirect(destination, 307);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function responseWithCookies(
  response: NextResponse,
  cookieMutations: readonly CookieMutation[],
): NextResponse {
  for (const { name, value, options } of cookieMutations) {
    response.cookies.set(name, value, options);
  }
  return response;
}
