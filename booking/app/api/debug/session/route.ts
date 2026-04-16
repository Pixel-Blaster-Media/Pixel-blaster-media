import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnostic endpoint — returns everything the server can see about
 * the current request's auth cookies. Intentionally unauthenticated
 * so it's usable when sign-in is broken.
 *
 * Exposes the access_token JWT payload (NOT the signature) which is
 * already visible in the `#access_token=` fragment during sign-in, so
 * this endpoint reveals no more info than a signed-in user already has.
 */
export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const projectRef = supabaseUrl
    ? new URL(supabaseUrl).hostname.split(".")[0]
    : "(NEXT_PUBLIC_SUPABASE_URL not set)";
  const cookieBase = `sb-${projectRef}-auth-token`;

  const allCookies = request.cookies.getAll().map((c) => ({
    name: c.name,
    length: c.value.length,
    preview: c.value.slice(0, 40),
  }));

  const primary = request.cookies.get(cookieBase)?.value;
  const chunks: string[] = [];
  for (let i = 0; ; i++) {
    const chunk = request.cookies.get(`${cookieBase}.${i}`)?.value;
    if (!chunk) break;
    chunks.push(chunk);
  }

  const raw = primary ?? (chunks.length > 0 ? chunks.join("") : null);

  let decodedLen: number | null = null;
  let parseError: string | null = null;
  let jwtPayload: unknown = null;
  let sessionPreview: unknown = null;
  let expires_at: number | null = null;
  let stillValid: boolean | null = null;

  if (raw) {
    try {
      let json: string;
      if (raw.startsWith("base64-")) {
        json = Buffer.from(raw.slice("base64-".length), "base64url").toString(
          "utf8",
        );
      } else {
        json = raw;
      }
      decodedLen = json.length;
      const session = JSON.parse(json) as {
        access_token?: string;
        refresh_token?: string;
        expires_at?: number;
        user?: { id?: string; email?: string };
      };
      sessionPreview = {
        has_access_token: !!session.access_token,
        access_token_length: session.access_token?.length ?? 0,
        has_refresh_token: !!session.refresh_token,
        expires_at: session.expires_at,
        user_id: session.user?.id,
        user_email: session.user?.email,
      };
      expires_at = session.expires_at ?? null;
      if (expires_at) {
        stillValid = expires_at > Math.floor(Date.now() / 1000) + 30;
      }
      if (session.access_token) {
        const parts = session.access_token.split(".");
        if (parts.length >= 2) {
          try {
            jwtPayload = JSON.parse(
              Buffer.from(parts[1], "base64url").toString("utf8"),
            );
          } catch (e) {
            parseError = "jwt decode: " + (e instanceof Error ? e.message : String(e));
          }
        }
      }
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json(
    {
      supabase_url_set: !!supabaseUrl,
      project_ref: projectRef,
      expected_cookie_name: cookieBase,
      cookies_received: allCookies,
      auth_cookie_found: !!raw,
      auth_cookie_is_chunked: !primary && chunks.length > 0,
      auth_cookie_chunk_count: chunks.length,
      auth_cookie_total_length: raw?.length ?? 0,
      has_base64_prefix: raw?.startsWith("base64-") ?? false,
      decoded_json_length: decodedLen,
      parse_error: parseError,
      session: sessionPreview,
      jwt_payload: jwtPayload,
      expires_at,
      now: Math.floor(Date.now() / 1000),
      still_valid: stillValid,
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
