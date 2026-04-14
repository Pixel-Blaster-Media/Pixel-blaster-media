import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { exchangeCodeForTokens } from "@/lib/integrations/quickbooks/oauth";
import { getServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "qbo_oauth_state";

/**
 * Intuit redirects the admin back here after consent. Params:
 *   - ?code=...      — one-time authorization code
 *   - ?state=...     — echo of our CSRF token (matches cookie)
 *   - ?realmId=...   — the QB company id
 *
 * We:
 *   1. Validate state against the cookie we set when the admin
 *      initiated the flow.
 *   2. Exchange the code for access + refresh tokens.
 *   3. Upsert the singleton `quickbooks_connection` row.
 *   4. Redirect back to the integrations settings page with a flash.
 */
export async function GET(request: NextRequest) {
  // Must be admin — no anon / realtor QB connections.
  const admin = await requireAdmin();

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const realmId = url.searchParams.get("realmId");
  const errorParam = url.searchParams.get("error");

  const settingsUrl = new URL("/admin/settings/integrations", url.origin);

  if (errorParam) {
    settingsUrl.searchParams.set("qbo_error", errorParam);
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !state || !realmId) {
    settingsUrl.searchParams.set("qbo_error", "missing_params");
    return NextResponse.redirect(settingsUrl);
  }

  const cookieStore = cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  if (!expectedState || expectedState !== state) {
    settingsUrl.searchParams.set("qbo_error", "state_mismatch");
    return NextResponse.redirect(settingsUrl);
  }
  // Single-use cookie — clear after validation.
  cookieStore.delete(STATE_COOKIE);

  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const environment = (process.env.QUICKBOOKS_ENVIRONMENT ?? "sandbox") as
    | "sandbox"
    | "production";

  if (!clientId || !clientSecret || !appUrl) {
    settingsUrl.searchParams.set("qbo_error", "not_configured");
    return NextResponse.redirect(settingsUrl);
  }

  const redirectUri = new URL(
    "/api/integrations/quickbooks/callback",
    appUrl,
  ).toString();

  let tokens;
  try {
    tokens = await exchangeCodeForTokens({
      code,
      redirectUri,
      clientId,
      clientSecret,
    });
  } catch (err) {
    console.error("[qbo.callback] token exchange failed", err);
    settingsUrl.searchParams.set("qbo_error", "token_exchange_failed");
    return NextResponse.redirect(settingsUrl);
  }

  const expiresAt = new Date(
    Date.now() + tokens.expires_in * 1000,
  ).toISOString();

  const supabase = getServiceSupabase();
  const { error } = await supabase.from("quickbooks_connection").upsert(
    {
      id: 1,
      environment,
      realm_id: realmId,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      access_token_expires_at: expiresAt,
      connected_by: admin.userId,
    },
    { onConflict: "id" },
  );

  if (error) {
    console.error("[qbo.callback] persist failed", error);
    settingsUrl.searchParams.set("qbo_error", "persist_failed");
    return NextResponse.redirect(settingsUrl);
  }

  settingsUrl.searchParams.set("qbo_connected", "1");
  return NextResponse.redirect(settingsUrl);
}
