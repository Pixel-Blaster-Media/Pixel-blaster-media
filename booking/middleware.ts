import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

/**
 * Edge middleware that:
 *   1. If the request carries a `?code=...` query param (a Supabase
 *      PKCE auth code, typically from a magic link), forward it to
 *      /auth/callback so the session can be established. This matters
 *      when a magic link comes from the Supabase dashboard (which
 *      hard-codes redirect_to to Site URL) rather than our own
 *      /auth/sign-in flow.
 *   2. Refreshes the Supabase auth session on every request (cookies
 *      have to be re-set on the response or they expire silently).
 *   3. Redirects unauthenticated visitors away from /admin and /portal
 *      to /auth/sign-in, preserving the originally-requested path in
 *      `?next=`.
 *
 * Role-level gating (admin vs realtor) happens later in the /admin
 * layout's Server Component — middleware can't do a DB query without
 * pulling the whole runtime in, and we only need the cheap "are you
 * signed in?" check at the edge.
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // 1. Auth-code handoff. If any page carries `?code=`, trust it's a
  // Supabase verify code and forward to the dedicated callback handler.
  // Exempt /auth/callback itself (otherwise we'd bounce infinitely) and
  // any API routes that might legitimately receive a `code` query param.
  const authCode = request.nextUrl.searchParams.get("code");
  if (
    authCode &&
    !path.startsWith("/auth/callback") &&
    !path.startsWith("/api/")
  ) {
    const callback = request.nextUrl.clone();
    callback.pathname = "/auth/callback";
    // Preserve the original path as ?next= so we land the user back where
    // they were heading (or on /admin if they came in at /).
    const next = path === "/" ? "/admin" : path;
    callback.searchParams.set("next", next);
    return NextResponse.redirect(callback);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // Refreshes the access token cookies if they came in and are still
  // fresh. We intentionally use getSession() rather than getUser() —
  // getUser() would make an outbound fetch to /auth/v1/user which can
  // fail intermittently from Vercel's runtime ("fetch failed") and
  // would then falsely mark a valid session as signed-out.
  //
  // getSession() reads the cookie locally via our cookie adapter and
  // only makes a network call to refresh if the access token is near
  // expiry. For a magic link we just wrote, it's fresh for an hour.
  //
  // If the stored access token looks expired (exp claim < now), we
  // treat the user as signed out without hitting the network at all.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const now = Math.floor(Date.now() / 1000);
  const sessionIsValid =
    !!session &&
    typeof session.expires_at === "number" &&
    session.expires_at > now;

  const protectedPath =
    path.startsWith("/admin") || path.startsWith("/portal");

  if (protectedPath && !sessionIsValid) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/sign-in";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Run on everything except static assets, the favicon, and image optimisation.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp)$).*)"],
};
