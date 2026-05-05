import "server-only";

import { cookies } from "next/headers";

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

/**
 * Mint the same cookie shape `@supabase/ssr` expects, given a token pair
 * already obtained (e.g. from /auth/v1/token?grant_type=password or from
 * admin-API signup followed by a fresh sign-in).
 *
 * Extracted from /auth/password/actions.ts so multiple entry points
 * (password sign-in, signup-on-booking) can share the exact same cookie
 * format. Divergence here causes weird "logged in on one page, not the
 * other" bugs.
 */
export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type?: string;
}

export function setSupabaseSessionCookie(tokens: SessionTokens, email: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL not set");
  }

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
  } catch (err) {
    throw new Error("Could not decode access_token: " + String(err));
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
}

/**
 * Call Supabase's password grant endpoint directly. Returns tokens on
 * success or an error string on failure. Mirrors the logic in
 * /auth/password/actions.ts but usable from any server action.
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
    return {
      ok: false,
      error: "Supabase env vars not configured",
      status: 500,
    };
  }

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
      ok: false,
      error:
        "Could not reach Supabase: " +
        (err instanceof Error ? err.message : String(err)),
      status: 500,
    };
  }

  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = (await res.json()) as {
        error_description?: string;
        msg?: string;
      };
      detail = body.error_description ?? body.msg ?? detail;
    } catch {
      /* ignore */
    }
    return { ok: false, error: detail, status: res.status };
  }

  const tokens = (await res.json()) as SessionTokens & {
    user?: { id?: string; email?: string };
  };
  if (!tokens.access_token || !tokens.refresh_token) {
    return {
      ok: false,
      error: "Supabase response missing tokens",
      status: 500,
    };
  }
  return { ok: true, tokens };
}
