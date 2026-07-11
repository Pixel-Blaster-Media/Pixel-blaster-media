import "server-only";

/**
 * QuickBooks Online OAuth 2.0 helpers.
 *
 * Intuit's flow:
 *   1. We redirect the admin to authorizeUrl() with our client_id +
 *      redirect_uri + scope + state.
 *   2. They grant; Intuit redirects back to /api/integrations/quickbooks/callback
 *      with ?code=... &state=... &realmId=...
 *   3. We POST to the token endpoint with the code to receive an
 *      access_token (~1h lifetime) and refresh_token (~100d sliding).
 *   4. We store the refresh_token; on every API call we check if the
 *      cached access token is stale and use refresh() to mint a new one.
 *
 * Intuit requires HTTP Basic auth with client_id:client_secret on the
 * token endpoint, not a JSON body client_id field — a common footgun.
 */

const QBO_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QBO_TOKEN_URL =
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

// Minimum scope for reading/writing customers + invoices.
const QBO_SCOPE = "com.intuit.quickbooks.accounting";

export type QBOEnvironment = "sandbox" | "production";

/**
 * Build the consent URL. `state` is echoed back on the callback; we use
 * it for a CSRF token (the caller stashes it in a short-lived cookie).
 */
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
    response_type: "code",
    scope: QBO_SCOPE,
    redirect_uri: redirectUri,
    state,
  });
  return `${QBO_AUTH_URL}?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  x_refresh_token_expires_in: number;
  token_type: "bearer";
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
  const res = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: basicAuth(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `QBO token exchange failed (${res.status}): ${body.slice(0, 500)}`,
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
  const res = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: basicAuth(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `QBO token refresh failed (${res.status}): ${body.slice(0, 500)}`,
    );
  }

  return (await res.json()) as TokenResponse;
}

/** Hostname for QBO API calls — sandbox vs production. */
export function apiBaseUrl(env: QBOEnvironment): string {
  return env === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

function basicAuth(id: string, secret: string): string {
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}
