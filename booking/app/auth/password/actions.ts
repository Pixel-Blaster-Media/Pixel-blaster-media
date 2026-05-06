"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

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

export interface PasswordSignInState {
  error?: string;
}

/**
 * Sign in with email + password.
 *
 * Bypasses every fancy auth path we've built:
 *   - No magic link, no email rate limit, no fragment-vs-PKCE flow.
 *   - No supabase.auth.signInWithPassword() either — just a direct
 *     POST to /auth/v1/token?grant_type=password using fetch, then
 *     write the resulting tokens straight into the session cookie
 *     using the same format @supabase/ssr expects.
 *
 * That last point matters: the user already hit a "fetch failed" /
 * 504 timeout cascade with the supabase-js path. Going direct
 * isolates this from the parts that have been flaky.
 *
 * To use this, the admin must first set a password on their account
 * in Supabase Authentication → Users → (their user) → Edit user.
 */
export async function signInWithPassword(
  _prev: PasswordSignInState | null,
  formData: FormData,
): Promise<PasswordSignInState> {
  const email = ((formData.get("email") as string | null) ?? "").trim().toLowerCase();
  const password = ((formData.get("password") as string | null) ?? "").toString();
  const next = safeNextPath(
    ((formData.get("next") as string | null) ?? "/admin").trim(),
  );

  if (!email || !password) {
    return { error: "Email and password are both required." };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { error: "Supabase env vars not configured on the server." };
  }

  // Direct REST call — no supabase-js wrapper, no client lifecycle.
  let res: Response;
  try {
    res = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: anonKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email, password }),
        cache: "no-store",
      },
    );
  } catch (err) {
    return {
      error:
        "Could not reach Supabase: " +
        (err instanceof Error ? err.message : String(err)),
    };
  }

  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = (await res.json()) as { error_description?: string; msg?: string };
      detail = body.error_description ?? body.msg ?? detail;
    } catch {
      /* ignore */
    }
    return { error: `Sign in rejected: ${detail}` };
  }

  let tokens: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    expires_at?: number;
    token_type: string;
    user?: { id?: string; email?: string };
  };
  try {
    tokens = await res.json();
  } catch {
    return { error: "Supabase returned an unexpected response." };
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    return { error: "Supabase response missing tokens." };
  }

  // Decode the JWT to recover the full user claim set + expiry.
  let payload: {
    sub: string;
    email?: string;
    role?: string;
    aud: string;
    exp: number;
    iat: number;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
    aal?: string;
    amr?: Array<Record<string, unknown>>;
  };
  try {
    const parts = tokens.access_token.split(".");
    payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
  } catch {
    return { error: "Could not decode access_token." };
  }

  const session = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type ?? "bearer",
    expires_in: tokens.expires_in,
    expires_at: tokens.expires_at ?? payload.exp,
    user: {
      id: payload.sub,
      aud: payload.aud,
      role: payload.role ?? "authenticated",
      email: payload.email ?? email,
      phone: "",
      app_metadata: payload.app_metadata ?? {},
      user_metadata: payload.user_metadata ?? {},
      aal: payload.aal,
      amr: payload.amr,
      created_at: new Date(payload.iat * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
  };

  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const cookieBase = `sb-${projectRef}-auth-token`;
  const encoded =
    "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");

  const cookieStore = cookies() as unknown as MutableCookieStore;

  // Wipe stale chunks first.
  for (const existing of cookieStore.getAll()) {
    if (
      existing.name === cookieBase ||
      existing.name.startsWith(`${cookieBase}.`)
    ) {
      cookieStore.delete(existing.name);
    }
  }

  cookieStore.set({
    name: cookieBase,
    value: encoded,
    httpOnly: false,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
  });

  redirect(next);
}

function safeNextPath(next: string): string {
  if (!next.startsWith("/") || next.startsWith("//")) return "/admin";
  if (next.startsWith("/auth/")) return "/admin";
  return next;
}
