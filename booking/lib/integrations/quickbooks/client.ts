import "server-only";

import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

import {
  apiBaseUrl,
  refreshAccessToken,
  type QBOEnvironment,
} from "./oauth";

/**
 * Authenticated QuickBooks Online REST client.
 *
 * Usage:
 *   const qb = await getQBClient();     // throws if not connected
 *   const customer = await qb.query(...);
 *
 * Auto-refreshes the access token when it's within 60s of expiry, and
 * persists the new tokens back to `quickbooks_connection`. Refresh
 * tokens themselves rotate on every refresh — Intuit issues a new one
 * each time, and the old one stops working after a grace window.
 */

type ConnectionRow =
  Database["public"]["Tables"]["quickbooks_connection"]["Row"];

import { createQBOTransport, QBOError } from './transport';
export { QBOError } from './transport';

export interface QBOClient {
  environment: QBOEnvironment;
  realmId: string;
  /** Raw request helper — returns parsed JSON. */
  request<T = unknown>(
    path: string,
    init?: {
      method?: "GET" | "POST" | "PUT";
      body?: Record<string, unknown>;
      query?: Record<string, string>;
    },
  ): Promise<T>;
  /** QBO's pseudo-SQL query endpoint. */
  query<T = unknown>(queryString: string): Promise<T>;
}

export interface QBConnectionScope {
  organizationId?: string;
}

function qbOrganizationId(scope?: QBConnectionScope): string {
  return scope?.organizationId ?? DEFAULT_ORGANIZATION_ID;
}

/**
 * Load the singleton connection row, refresh the token if needed, and
 * return a client. Throws if no connection exists — caller should
 * surface that as "connect QuickBooks first" in the UI.
 */
export async function getQBClient(
  scope?: QBConnectionScope,
): Promise<QBOClient> {
  const supabase = getServiceSupabase();
  const orgId = qbOrganizationId(scope);
  const { data: conn, error } = await supabase
    .from("quickbooks_connection")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle<ConnectionRow>();

  if (error) throw new Error(`QBO connection lookup failed: ${error.message}`);
  if (!conn) throw new QBOError("QuickBooks is not connected.", 401, "");

  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET not configured.",
    );
  }

  const accessToken = await ensureFreshToken(conn, clientId, clientSecret);
  const base = apiBaseUrl(conn.environment);

  const request = createQBOTransport({base, realmId:conn.realm_id, accessToken});

  return {
    environment: conn.environment,
    realmId: conn.realm_id,
    request,
    query<T = unknown>(q: string) {
      return request<T>("/query", { query: { query: q } });
    },
  };
}

/**
 * Check the stored access token; if it's missing or within 60s of
 * expiry, refresh via the refresh_token and persist both new tokens.
 */
async function ensureFreshToken(
  conn: ConnectionRow,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const now = Date.now();
  const expiresAt = conn.access_token_expires_at
    ? new Date(conn.access_token_expires_at).getTime()
    : 0;

  if (conn.access_token && expiresAt - now > 60_000) {
    return conn.access_token;
  }

  const tokens = await refreshAccessToken({
    refreshToken: conn.refresh_token,
    clientId,
    clientSecret,
  });

  const newExpiry = new Date(now + tokens.expires_in * 1000).toISOString();
  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("quickbooks_connection")
    .update({
      access_token: tokens.access_token,
      access_token_expires_at: newExpiry,
      refresh_token: tokens.refresh_token,
    })
    .eq("id", conn.id);

  if (error) {
    console.error("[qbo] failed to persist refreshed token", error);
  }

  return tokens.access_token;
}
