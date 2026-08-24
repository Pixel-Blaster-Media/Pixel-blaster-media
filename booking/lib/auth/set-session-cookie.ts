import "server-only";

import { cookies } from "next/headers";

import {
  parseVerifiedAccessTokenClaims,
  requireVerifiedAccessToken,
  type VerifiedSupabaseUser,
} from "@/lib/auth/verified-access-token";
import { getServerSupabase } from "@/lib/supabase/server";

type MutableCookieStore = {
  getAll(): Array<{ name: string; value: string }>;
  delete(name: string): void;
  set(options: {
    name: string;
    value: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "lax";
    path: string;
    maxAge: number;
  }): void;
};

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type?: string;
}

const MAX_REFRESH_TOKEN_LENGTH = 16_384;
const MAX_PROVIDER_RESPONSE_BYTES = 65_536;
const COOKIE_CHUNK_SIZE = 3_180;

/**
 * Verify a Supabase access token, then install the matching SSR cookie.
 * Callers may pass a user already verified in the same request to avoid a
 * duplicate Auth request; the parsed token subject must still match it.
 */
export async function setSupabaseSessionCookie(
  tokens: SessionTokens,
  fallbackEmail: string,
  alreadyVerifiedUser?: VerifiedSupabaseUser,
): Promise<VerifiedSupabaseUser> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("Supabase authentication is not configured.");
  if (
    typeof tokens.refresh_token !== "string" ||
    tokens.refresh_token.length === 0 ||
    tokens.refresh_token.length > MAX_REFRESH_TOKEN_LENGTH
  ) {
    throw new Error("Invalid refresh token.");
  }

  const supabase = await getServerSupabase();
  const verifiedUser =
    alreadyVerifiedUser ??
    (await requireVerifiedAccessToken(tokens.access_token, async (accessToken) => {
      const { data, error } = await supabase.auth.getUser(accessToken);
      return {
        data: {
          user: data.user
            ? {
                id: data.user.id,
                aud: data.user.aud,
                email: data.user.email,
                role: data.user.role,
                app_metadata: data.user.app_metadata,
                user_metadata: data.user.user_metadata,
                created_at: data.user.created_at,
                updated_at: data.user.updated_at,
                phone: data.user.phone,
              }
            : null,
        },
        error,
      };
    }));
  const claims = parseVerifiedAccessTokenClaims(
    tokens.access_token,
    verifiedUser.id,
  );
  const now = Math.floor(Date.now() / 1000);

  const session = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type ?? "bearer",
    expires_in: Math.max(claims.exp - now, 0),
    expires_at: claims.exp,
    user: {
      id: verifiedUser.id,
      aud: verifiedUser.aud || claims.aud,
      role: verifiedUser.role ?? claims.role ?? "authenticated",
      email: verifiedUser.email ?? fallbackEmail,
      phone: verifiedUser.phone ?? "",
      app_metadata: verifiedUser.app_metadata,
      user_metadata: verifiedUser.user_metadata,
      aal: verifiedUser.aal ?? claims.aal,
      amr: verifiedUser.amr ?? claims.amr,
      created_at: verifiedUser.created_at,
      updated_at: verifiedUser.updated_at ?? new Date().toISOString(),
    },
  };

  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  if (!projectRef) throw new Error("Invalid Supabase authentication URL.");
  const cookieBase = `sb-${projectRef}-auth-token`;
  const encoded =
    "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const cookieStore = (await cookies()) as unknown as MutableCookieStore;

  for (const existing of cookieStore.getAll()) {
    if (
      existing.name === cookieBase ||
      existing.name.startsWith(`${cookieBase}.`)
    ) {
      cookieStore.delete(existing.name);
    }
  }

  const options = {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
  };
  if (encoded.length <= COOKIE_CHUNK_SIZE) {
    cookieStore.set({ name: cookieBase, value: encoded, ...options });
  } else {
    let index = 0;
    for (let offset = 0; offset < encoded.length; offset += COOKIE_CHUNK_SIZE) {
      cookieStore.set({
        name: `${cookieBase}.${index}`,
        value: encoded.slice(offset, offset + COOKIE_CHUNK_SIZE),
        ...options,
      });
      index += 1;
    }
  }

  return verifiedUser;
}

/**
 * Call Supabase's password grant endpoint directly. Returns tokens on
 * success or a bounded error classification on failure.
 */
export async function signInWithPasswordREST(
  email: string,
  password: string,
): Promise<
  | { ok: true; tokens: SessionTokens }
  | { ok: false; error: string; status: number }
> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { ok: false, error: "not_configured", status: 500 };
  }

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, error: "unavailable", status: 503 };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: res.status === 400 || res.status === 401 ? "invalid_credentials" : "rejected",
      status: res.status,
    };
  }

  const parsedResponse = await readBoundedProviderJson(
    res,
    MAX_PROVIDER_RESPONSE_BYTES,
  );
  if (!parsedResponse.ok) {
    return { ok: false, error: "malformed_response", status: 502 };
  }
  const tokens = parsedResponse.value as SessionTokens;
  if (
    !tokens.access_token ||
    !tokens.refresh_token ||
    !Number.isFinite(tokens.expires_in)
  ) {
    return { ok: false, error: "malformed_response", status: 502 };
  }
  return { ok: true, tokens };
}

async function readBoundedProviderJson(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const mediaType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") return { ok: false };

  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      return { ok: false };
    }
  }
  if (!response.body) return { ok: false };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > maxBytes) {
        void reader.cancel().catch(() => undefined);
        return { ok: false };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}
