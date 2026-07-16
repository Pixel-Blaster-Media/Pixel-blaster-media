import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  getGoogleCalendarConnection,
  persistTokens,
  tokensFromExchange,
} from "@/lib/integrations/google-calendar/client";
import {
  emailFromIdToken,
  exchangeCodeForTokens,
  GOOGLE_REQUIRED_CALENDAR_SCOPES,
} from "@/lib/integrations/google-calendar/oauth";
import { missingGrantedScopes } from "@/lib/integrations/google-calendar/scope-grants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "google_oauth_state";

type MutableCookieStore = {
  get(name: string): { value: string } | undefined;
  delete(name: string): void;
};

/**
 * Google redirects the admin back here after consent with:
 *   - ?code=...   — one-time authorization code
 *   - ?state=...  — echo of our CSRF token (matches cookie we set at kickoff)
 *   - ?error=...  — set when the admin denied consent
 *
 * We:
 *   1. Validate state against the cookie.
 *   2. Exchange the code for access + refresh tokens.
 *   3. Decode the id_token's "email" claim for display in the admin UI.
 *   4. Upsert the singleton google_calendar_connection row.
 *   5. Redirect back to the integrations settings page with a flash.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const settingsUrl = new URL("/admin/settings/integrations", url.origin);

  if (errorParam) {
    settingsUrl.searchParams.set("google_error", errorParam);
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !state) {
    settingsUrl.searchParams.set("google_error", "missing_params");
    return NextResponse.redirect(settingsUrl);
  }

  const cookieStore = (await cookies()) as unknown as MutableCookieStore;
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  if (!expectedState || expectedState !== state) {
    settingsUrl.searchParams.set("google_error", "state_mismatch");
    return NextResponse.redirect(settingsUrl);
  }

  // Burn the state cookie so it can't be replayed.
  cookieStore.delete(STATE_COOKIE);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!clientId || !clientSecret || !appUrl) {
    settingsUrl.searchParams.set("google_error", "server_misconfigured");
    return NextResponse.redirect(settingsUrl);
  }
  const redirectUri = new URL(
    "/api/integrations/google-calendar/callback",
    appUrl,
  ).toString();

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      redirectUri,
      clientId,
      clientSecret,
    });

    const missingScopes = missingGrantedScopes(
      tokens.scope,
      GOOGLE_REQUIRED_CALENDAR_SCOPES,
    );
    if (missingScopes.length > 0) {
      // Google supports granular consent. Never replace a working connection
      // with a partial grant that cannot check availability or write events.
      settingsUrl.searchParams.set("google_error", "missing_calendar_scopes");
      return NextResponse.redirect(settingsUrl);
    }

    const { accessToken, expiresInSeconds, refreshToken } =
      tokensFromExchange(tokens);

    if (!refreshToken) {
      // With prompt=consent + access_type=offline we should always get
      // a refresh token on the first grant. If Google didn't return one
      // (e.g. the user revoked and re-consented without prompt), we
      // can't proceed — surface the error so the admin can retry.
      settingsUrl.searchParams.set("google_error", "no_refresh_token");
      return NextResponse.redirect(settingsUrl);
    }

    const email = emailFromIdToken(tokens.id_token);
    if (!email) {
      settingsUrl.searchParams.set("google_error", "missing_account_email");
      return NextResponse.redirect(settingsUrl);
    }

    const existingConnection = await getGoogleCalendarConnection({
      organizationId: admin.organizationId,
    });
    const existingEmail = existingConnection?.google_account_email
      .trim()
      .toLowerCase();
    if (
      existingEmail &&
      existingEmail !== "unknown" &&
      existingEmail !== email.trim().toLowerCase()
    ) {
      // Saved calendar ids belong to the original account. Switching accounts
      // in place would leave those sources stale; disconnect explicitly first.
      settingsUrl.searchParams.set("google_error", "google_account_mismatch");
      return NextResponse.redirect(settingsUrl);
    }

    await persistTokens({
      organizationId: admin.organizationId,
      googleAccountEmail: email,
      refreshToken,
      accessToken,
      expiresInSeconds,
      connectedBy: admin.userId,
    });

    settingsUrl.searchParams.set("google_connected", "1");
    return NextResponse.redirect(settingsUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    settingsUrl.searchParams.set(
      "google_error",
      msg.slice(0, 200),
    );
    return NextResponse.redirect(settingsUrl);
  }
}
