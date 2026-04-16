import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Client-to-server session bridge.
 *
 * Magic links sent from the Supabase dashboard use the implicit flow
 * (`#access_token=...` in the URL fragment). Fragments never reach the
 * server, so middleware can't pick them up.
 *
 * The client extracts tokens from the fragment and POSTs them here.
 * We decode the access_token JWT to extract the user claims + expiry,
 * build a Session object in the shape that @supabase/ssr's cookie
 * storage expects, and write it to the `sb-<project-ref>-auth-token`
 * cookie (chunked if it exceeds cookie size limits).
 *
 * We deliberately do NOT call supabase.auth.setSession() here because
 * that internally makes a fetch to /auth/v1/user for validation, and
 * that outbound call can fail from Vercel's serverless runtime
 * (intermittently — reported as "fetch failed"). The access_token was
 * already signed and issued by Supabase at the /auth/v1/verify
 * endpoint immediately prior to this call, so re-validating it is
 * belt-and-suspenders we don't need.
 *
 * The endpoint is intentionally unauthenticated — it HAS to be
 * callable before a session exists.
 */
export async function POST(request: NextRequest) {
  let body: { access_token?: string; refresh_token?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const { access_token, refresh_token } = body;
  if (!access_token || !refresh_token) {
    return NextResponse.json(
      { ok: false, error: "access_token and refresh_token are required." },
      { status: 400 },
    );
  }

  // Decode the JWT payload (middle segment). Access tokens are signed
  // by Supabase — if the signature's wrong, the next /auth/v1/user call
  // will fail and the user will be re-prompted to sign in. For writing
  // the cookie here, we only need the payload claims.
  let payload: {
    sub: string;
    aud: string;
    email?: string;
    role?: string;
    exp: number;
    iat: number;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
    aal?: string;
    amr?: Array<Record<string, unknown>>;
    session_id?: string;
  };
  try {
    const parts = access_token.split(".");
    if (parts.length < 2) throw new Error("Malformed JWT");
    payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
  } catch (err) {
    console.error("[auth.bridge] JWT decode failed", err);
    return NextResponse.json(
      { ok: false, error: "Could not decode access_token." },
      { status: 400 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return NextResponse.json(
      { ok: false, error: "NEXT_PUBLIC_SUPABASE_URL not configured." },
      { status: 500 },
    );
  }
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];

  // Shape matches @supabase/supabase-js's `Session` type. Unknown-at-
  // this-layer fields (e.g. provider tokens from OAuth) are omitted;
  // supabase-js treats them as optional.
  const now = Math.floor(Date.now() / 1000);
  const session = {
    access_token,
    refresh_token,
    token_type: "bearer",
    expires_in: Math.max(payload.exp - now, 0),
    expires_at: payload.exp,
    user: {
      id: payload.sub,
      aud: payload.aud,
      role: payload.role ?? "authenticated",
      email: payload.email ?? "",
      phone: "",
      app_metadata: payload.app_metadata ?? {},
      user_metadata: payload.user_metadata ?? {},
      aal: payload.aal,
      amr: payload.amr,
      created_at: new Date(payload.iat * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
  };

  // @supabase/ssr v0.5+ stores the session as `base64-` + base64url
  // encoded JSON (note: base64URL, not standard base64 — it uses the
  // URL-safe alphabet with `-` and `_` and no padding). Getting this
  // wrong means the server client silently fails to parse and treats
  // the user as signed out.
  const encoded =
    "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");

  const cookieBase = `sb-${projectRef}-auth-token`;
  const cookieStore = cookies();

  // Clear any stale chunks from a previous sign-in before writing new ones.
  for (const existing of cookieStore.getAll()) {
    if (
      existing.name === cookieBase ||
      existing.name.startsWith(`${cookieBase}.`)
    ) {
      cookieStore.delete(existing.name);
    }
  }

  // Match @supabase/ssr's DEFAULT_COOKIE_OPTIONS exactly — notably
  // httpOnly: false, because the browser client also reads these
  // cookies to keep its in-memory session state in sync.
  const baseOptions = {
    httpOnly: false,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
  };

  // Cookie value size ceiling is ~4 KB; leave headroom for the name +
  // cookie attributes.
  const CHUNK_SIZE = 3180;

  if (encoded.length <= CHUNK_SIZE) {
    cookieStore.set({
      name: cookieBase,
      value: encoded,
      ...baseOptions,
    });
  } else {
    let index = 0;
    for (let pos = 0; pos < encoded.length; pos += CHUNK_SIZE) {
      cookieStore.set({
        name: `${cookieBase}.${index}`,
        value: encoded.slice(pos, pos + CHUNK_SIZE),
        ...baseOptions,
      });
      index += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    user: { id: session.user.id, email: session.user.email },
  });
}
