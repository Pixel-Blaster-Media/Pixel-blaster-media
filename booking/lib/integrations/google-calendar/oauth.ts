import "server-only";

/**
 * Google OAuth 2.0 helpers for Google Calendar.
 *
 * Flow:
 *   1. We redirect the admin to buildAuthorizeUrl() with client_id,
 *      redirect_uri, scope, state, access_type=offline, prompt=consent.
 *   2. Google shows a consent screen; on grant, redirects back to
 *      /api/integrations/google-calendar/callback with ?code=... &state=...
 *   3. We POST to the token endpoint with the code to receive an
 *      access_token (~1h), refresh_token (long-lived), and id_token.
 *   4. We decode the id_token's "email" claim so the admin UI can show
 *      which Google account is connected.
 *   5. We store the refresh_token; every API call either uses the cached
 *      access token (if not stale) or refresh()es to mint a new one.
 *
 * Scope choice: calendar.events gives read+write on events only. That's
 * everything we need (free/busy query + insert event). We deliberately
 * don't ask for full calendar scope — principle of least privilege.
 */

export const GOOGLE_AUTH_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * openid + email give us the connected account's email via the id_token.
 * calendar.events is read+write on events only. No settings, no sharing.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

export function buildAuthorizeUrl({
  clientId,
  redirectUri,
  state,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    // Required to get a refresh_token back. Without access_type=offline,
    // Google only returns an access_token that expires in an hour.
    access_type: "offline",
    // Forces the consent screen every time so we get a refresh_token
    // even on re-connects (Google omits it on silent re-auth otherwise).
    prompt: "consent",
    include_granted_scopes: "true",
  });
  params.set("state", state);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  /** Present on the first consent with prompt=consent + access_type=offline. */
  refresh_token?: string;
  expires_in: number; // seconds
  token_type: "Bearer";
  scope: string;
  /** JWT containing the user's email — only present when openid scope is requested. */
  id_token?: string;
}

export async function exchangeCodeForTokens({
  code,
  redirectUri,
  clientId,
  clientSecret,
}: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Google token exchange failed (${res.status}): ${body.slice(0, 500)}`,
    );
  }

  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken({
  refreshToken,
  clientId,
  clientSecret,
}: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Google token refresh failed (${res.status}): ${body.slice(0, 500)}`,
    );
  }

  return (await res.json()) as TokenResponse;
}

/**
 * Best-effort revoke. Google accepts either an access or refresh token.
 * We don't fail the disconnect flow on revoke errors — local deletion is
 * sufficient, and revocation can fail if the token is already invalid.
 */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(
      `${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`,
      { method: "POST" },
    );
  } catch {
    // swallowed — admin just wants it disconnected locally
  }
}

/**
 * Decode an id_token's payload WITHOUT verifying the signature. We only use
 * this to surface the connected email in the admin UI — never to authorize
 * anything. Google already validated the signature on its end before
 * issuing the token, and we received it over TLS directly from Google.
 */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].padEnd(
      parts[1].length + ((4 - (parts[1].length % 4)) % 4),
      "=",
    );
    const json = Buffer.from(
      padded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf-8");
    const payload = JSON.parse(json) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}
