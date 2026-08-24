import { NextResponse, type NextRequest } from "next/server";

import {
  AuthTokenVerificationError,
  requireVerifiedAccessToken,
} from "@/lib/auth/verified-access-token";
import {
  setSupabaseSessionCookie,
} from "@/lib/auth/set-session-cookie";
import { exchangeSupabaseRefreshToken } from "@/lib/auth/supabase-refresh-exchange";
import { readBoundedJsonBody } from "@/lib/security/bounded-json-body";
import { verifyProductionProxyRequest } from "@/lib/security/production-proxy-attestation";
import { isSameOriginRequest } from "@/lib/security/request-origin";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 40_000;
const MAX_REFRESH_TOKEN_LENGTH = 16_384;

/**
 * Establishes the SSR session for Supabase implicit-flow magic links.
 * The endpoint is public because the browser has no cookie yet, so access
 * tokens are verified by Supabase Auth before any cookie is installed.
 */
export async function POST(request: NextRequest) {
  const productionProxyHost =
    process.env.BOOKING_PROXY_UPSTREAM_HOST ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const trustedProductionProxy = await verifyProductionProxyRequest(
    request,
    process.env.BOOKING_PROXY_SHARED_SECRET,
    {
      canonicalHost: configuredCanonicalHost(),
      productionProxyHost,
    },
  );
  if (!isSameOriginRequest(request.headers.get("origin"), request.nextUrl, {
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    productionProxyHost,
    trustedProductionProxy,
  })) {
    return jsonError("Cross-origin request rejected.", 403);
  }

  const parsedBody = await readBoundedJsonBody(request, MAX_BODY_BYTES);
  if (!parsedBody.ok) {
    if (parsedBody.kind === "too_large") {
      return jsonError("Request body is too large.", 413);
    }
    if (parsedBody.kind === "unsupported_media_type") {
      return jsonError("Content-Type must be application/json.", 415);
    }
    return jsonError("Invalid JSON body.", 400);
  }
  const body = parsedBody.value;
  if (!isTokenPair(body)) {
    return jsonError("A valid access and refresh token pair is required.", 400);
  }
  const { access_token, refresh_token } = body;

  const supabase = await getServerSupabase();
  let verifiedUser;
  try {
    verifiedUser = await requireVerifiedAccessToken(
      access_token,
      async (token) => supabase.auth.getUser(token),
    );
  } catch (error) {
    if (error instanceof AuthTokenVerificationError) {
      return jsonError(
        error.kind === "unavailable"
          ? "Authentication verification is temporarily unavailable."
          : "The sign-in link is invalid or expired.",
        error.kind === "unavailable" ? 503 : 401,
      );
    }
    return jsonError("Authentication verification failed.", 503);
  }

  const refreshExchange = await exchangeSupabaseRefreshToken(refresh_token, {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!refreshExchange.ok) {
    return jsonError(
      refreshExchange.kind === "invalid"
        ? "The sign-in link is invalid or expired."
        : "Authentication verification is temporarily unavailable.",
      refreshExchange.kind === "invalid" ? 401 : 503,
    );
  }

  try {
    await setSupabaseSessionCookie(
      refreshExchange.tokens,
      verifiedUser.email ?? "",
      verifiedUser,
    );
  } catch (error) {
    if (error instanceof AuthTokenVerificationError) {
      return jsonError(
        error.kind === "unavailable"
          ? "Authentication verification is temporarily unavailable."
          : "The sign-in link token pair is invalid.",
        error.kind === "unavailable" ? 503 : 401,
      );
    }
    return jsonError("Could not establish the authenticated session.", 503);
  }

  return NextResponse.json(
    {
      ok: true,
      user: { id: verifiedUser.id, email: verifiedUser.email ?? "" },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function isTokenPair(
  value: unknown,
): value is { access_token: string; refresh_token: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    typeof record.access_token !== "string" ||
    typeof record.refresh_token !== "string"
  ) {
    return false;
  }
  return (
    record.access_token.length > 0 &&
    record.refresh_token.length > 0 &&
    record.refresh_token.length <= MAX_REFRESH_TOKEN_LENGTH
  );
}

function jsonError(error: string, status: number) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function configuredCanonicalHost(): string | null {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "https://pixelblastermedia.com";
  try {
    const url = new URL(configured);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.hostname.endsWith(".vercel.app")
    ) {
      return null;
    }
    return url.hostname;
  } catch {
    return null;
  }
}
