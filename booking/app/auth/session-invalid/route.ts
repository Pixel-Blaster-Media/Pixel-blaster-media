import { NextResponse, type NextRequest } from "next/server";

import {
  safeLoginRequestedPath,
  type LoginAudience,
} from "@/lib/auth/account-destination";
import {
  getPresentSupabaseAuthCookieNames,
  getSupabaseAuthCookieBaseName,
} from "@/lib/auth/supabase-auth-cookie-family";
import { publicRedirectOrigin } from "@/lib/security/canonical-app-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * Clears a terminally invalid Supabase session at a cookie-mutable boundary.
 * Protected RSC guards cannot reliably persist cookie deletion, so they route
 * invalid (not unavailable) sessions here before sending the browser to login.
 */
export async function GET(request: NextRequest) {
  const source = new URL(request.url);
  const redirectOrigin = publicRedirectOrigin(source);
  const audience = loginAudience(source.searchParams.get("audience"));
  const next = safeLoginRequestedPath(
    audience,
    source.searchParams.get("next"),
  );
  const cookieBase = getSupabaseAuthCookieBaseName(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );

  if (!cookieBase) {
    return noStoreRedirect(
      new URL("/auth/access-unavailable", redirectOrigin),
    );
  }

  const requestCookies = request.cookies.getAll();
  const destination = new URL("/auth/sign-in", redirectOrigin);
  destination.searchParams.set("audience", audience);
  destination.searchParams.set("next", next);
  const response = noStoreRedirect(destination);

  for (const cookieName of getPresentSupabaseAuthCookieNames(
    requestCookies,
    cookieBase,
  )) {
    response.cookies.set(cookieName, "", {
      httpOnly: true,
      secure: redirectOrigin.protocol === "https:",
      sameSite: "lax",
      path: "/",
      expires: new Date(0),
      maxAge: 0,
    });
  }

  return response;
}

function loginAudience(value: string | null): LoginAudience {
  return value === "realtor" ? "realtor" : "company";
}


function noStoreRedirect(destination: URL): NextResponse {
  const response = NextResponse.redirect(destination, 307);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
