import {
  getSupabaseAuthCookieBaseName,
  getSupabaseAuthCookieChunkIndex,
  SUPABASE_AUTH_COOKIE_READ_CHUNK_LIMIT,
} from "./supabase-auth-cookie-family.ts";

export type SupabaseSessionExpiryState =
  | "missing"
  | "fresh"
  | "near_expiry"
  | "unreadable";

export type SupabaseSessionRefreshHint = {
  state: SupabaseSessionExpiryState;
  refreshToken: string | null;
};

export interface SessionCookieValue {
  name: string;
  value: string;
}

const BASE64_PREFIX = "base64-";
export const SUPABASE_SESSION_COOKIE_MAX_ENCODED_LENGTH = 65_536;
const MAX_SESSION_TOKEN_LENGTH = 16_384;
const MAX_SESSION_USER_ID_LENGTH = 256;

// auth-js 2.103.0 implicitly refreshes inside its locked 90-second margin.
// Route 30 seconds earlier so rotation always occurs at the cookie-mutable
// boundary rather than racing the subsequent RSC verifier.
export const SUPABASE_SESSION_REFRESH_SKEW_SECONDS = 120;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * Reads only Supabase's untrusted session-expiry hint. This is a routing hint,
 * never identity or authorization: the refreshed request is still verified by
 * Supabase Auth before any protected data is returned.
 */
export function supabaseSessionExpiryState(
  cookies: readonly SessionCookieValue[],
  supabaseUrl: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
  refreshSkewSeconds = SUPABASE_SESSION_REFRESH_SKEW_SECONDS,
): SupabaseSessionExpiryState {
  return supabaseSessionRefreshHint(
    cookies,
    supabaseUrl,
    nowSeconds,
    refreshSkewSeconds,
  ).state;
}

/** Returns the untrusted refresh token only for the mutable refresh boundary.
 * Supabase Auth still validates it before any session is accepted. */
export function supabaseSessionRefreshHint(
  cookies: readonly SessionCookieValue[],
  supabaseUrl: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
  refreshSkewSeconds = SUPABASE_SESSION_REFRESH_SKEW_SECONDS,
): SupabaseSessionRefreshHint {
  const cookieName = getSupabaseAuthCookieBaseName(supabaseUrl);
  if (!cookieName) return { state: "unreadable", refreshToken: null };
  if (!Number.isSafeInteger(nowSeconds) || !Number.isSafeInteger(refreshSkewSeconds)) {
    return { state: "unreadable", refreshToken: null };
  }

  const encoded = combinedCookieValue(cookies, cookieName);
  if (encoded.kind !== "value") {
    return { state: encoded.kind, refreshToken: null };
  }
  if (encoded.value.length > SUPABASE_SESSION_COOKIE_MAX_ENCODED_LENGTH) {
    return { state: "unreadable", refreshToken: null };
  }

  try {
    const text = encoded.value.startsWith(BASE64_PREFIX)
      ? decodeBase64Url(encoded.value.slice(BASE64_PREFIX.length))
      : encoded.value;
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { state: "unreadable", refreshToken: null };
    }
    const session = parsed as Record<string, unknown>;
    if (!hasStructurallyReadableSessionFields(session)) {
      return { state: "unreadable", refreshToken: null };
    }
    const expiresAt = session.expires_at;
    if (!Number.isSafeInteger(expiresAt) || (expiresAt as number) <= 0) {
      return { state: "unreadable", refreshToken: null };
    }
    const refreshToken =
      typeof session.refresh_token === "string" && session.refresh_token.length > 0
        ? session.refresh_token
        : null;
    return {
      state:
        (expiresAt as number) <= nowSeconds + refreshSkewSeconds
          ? "near_expiry"
          : "fresh",
      refreshToken,
    };
  } catch {
    return { state: "unreadable", refreshToken: null };
  }
}

function hasStructurallyReadableSessionFields(
  session: Record<string, unknown>,
): boolean {
  for (const token of [session.access_token, session.refresh_token]) {
    if (
      typeof token !== "string" ||
      token.length === 0 ||
      token.length > MAX_SESSION_TOKEN_LENGTH
    ) {
      return false;
    }
  }

  if (
    session.token_type !== undefined &&
    (typeof session.token_type !== "string" ||
      session.token_type.toLowerCase() !== "bearer")
  ) {
    return false;
  }
  if (
    session.expires_in !== undefined &&
    (!Number.isSafeInteger(session.expires_in) ||
      (session.expires_in as number) <= 0)
  ) {
    return false;
  }

  if (session.user !== undefined) {
    if (
      !session.user ||
      typeof session.user !== "object" ||
      Array.isArray(session.user)
    ) {
      return false;
    }
    const userId = (session.user as Record<string, unknown>).id;
    if (
      typeof userId !== "string" ||
      userId.length === 0 ||
      userId.length > MAX_SESSION_USER_ID_LENGTH
    ) {
      return false;
    }
  }

  return true;
}

function combinedCookieValue(
  cookies: readonly SessionCookieValue[],
  cookieName: string,
):
  | { kind: "missing" | "unreadable" }
  | { kind: "value"; value: string } {
  const primaryCookies = cookies.filter((cookie) => cookie.name === cookieName);
  const hasCanonicalChunks = cookies.some(
    (cookie) => getSupabaseAuthCookieChunkIndex(cookie.name, cookieName) !== null,
  );
  if (primaryCookies.length > 0) {
    if (primaryCookies.length !== 1 || hasCanonicalChunks) {
      return { kind: "unreadable" };
    }
    const primary = primaryCookies[0].value;
    return primary ? { kind: "value", value: primary } : { kind: "unreadable" };
  }

  const chunks = new Map<number, string>();
  for (const cookie of cookies) {
    const index = getSupabaseAuthCookieChunkIndex(cookie.name, cookieName);
    if (index === null) continue;
    if (index >= SUPABASE_AUTH_COOKIE_READ_CHUNK_LIMIT || chunks.has(index)) {
      return { kind: "unreadable" };
    }
    chunks.set(index, cookie.value);
  }
  if (chunks.size === 0) return { kind: "missing" };
  if (!chunks.has(0)) return { kind: "unreadable" };

  const maxIndex = Math.max(...chunks.keys());
  if (chunks.size !== maxIndex + 1) return { kind: "unreadable" };
  let value = "";
  for (let index = 0; index <= maxIndex; index += 1) {
    const chunk = chunks.get(index);
    if (!chunk) return { kind: "unreadable" };
    value += chunk;
    if (value.length > SUPABASE_SESSION_COOKIE_MAX_ENCODED_LENGTH) return { kind: "unreadable" };
  }
  return { kind: "value", value };
}

function decodeBase64Url(value: string): string {
  if (!value || !BASE64URL.test(value)) throw new Error("Invalid base64url");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (base64.length % 4)) % 4;
  const binary = atob(`${base64}${"=".repeat(padding)}`);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
