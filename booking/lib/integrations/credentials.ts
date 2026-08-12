import "server-only";

import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";
import { getServiceSupabase } from "@/lib/supabase/server";
import { resolveCredentialStrict } from "@/lib/integrations/credentials-core";

/**
 * DB-backed credential store with env-var fallback.
 *
 * Each provider stores its credentials as a single jsonb row in
 * `integration_credentials`. The runtime resolution order for any
 * given key is:
 *
 *   1. The named field on the provider's row, if present and non-empty.
 *   2. For the default Pixel Blaster organization only, the matching
 *      deployment environment variable as a legacy fallback.
 *   3. null.
 *
 * Migration is lazy: existing env-var-only setups keep working until
 * the admin saves a value through the UI, at which point that field
 * starts coming from the DB. There's no big-bang migration step.
 *
 * This file uses the service-role client so it works from any server
 * context (server actions, route handlers, server components). RLS on
 * the table is admin-only for SELECT, but we read with the service
 * role so the runtime path doesn't depend on the caller being admin
 * — a webhook handler, for instance, has no admin session to check
 * against.
 */

export type Provider =
  | "admin_settings"
  | "autohdr"
  | "autoenhance"
  | "fotello"
  | "google_maps"
  | "iguide"
  | "openai"
  | "resend";

interface CredentialsRow {
  organization_id: string;
  provider: string;
  credentials: Record<string, string>;
}

// Per-process cache. Cold starts in serverless reset this naturally,
// and a single warm request never reads the same row twice. We
// invalidate on any save via clearCredentialsCache().
const cache = new Map<string, Record<string, string>>();

function cacheKey(provider: Provider, organizationId: string): string {
  return `${organizationId}:${provider}`;
}

async function loadProvider(
  provider: Provider,
  organizationId: string,
  failOnReadError = false,
): Promise<Record<string, string>> {
  const key = cacheKey(provider, organizationId);
  const cached = cache.get(key);
  if (cached && !failOnReadError) return cached;

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("integration_credentials")
    .select("organization_id, provider, credentials")
    .eq("organization_id", organizationId)
    .eq("provider", provider)
    .maybeSingle<CredentialsRow>();

  if (error) {
    console.warn(
      `[credentials] DB read failed for ${provider}`,
      error.message,
    );
    if (failOnReadError) {
      throw new Error("Credential state is temporarily unavailable.");
    }
    return {};
  }

  const row = data?.credentials ?? {};
  cache.set(key, row);
  return row;
}

/**
 * Get a single credential field, preferring DB then env var. Returns
 * null when neither has a value, so the caller can render its own
 * "not configured" UI without having to handle a thrown error.
 */
export async function getCredential(
  provider: Provider,
  field: string,
  envVar: string,
  organizationId: string,
): Promise<string | null> {
  const row = await loadProvider(provider, organizationId);
  const fromDb = row[field]?.trim();
  if (fromDb) return fromDb;
  const fromEnv =
    organizationId === DEFAULT_ORGANIZATION_ID
      ? process.env[envVar]?.trim()
      : undefined;
  return fromEnv || null;
}

/** Provider enablement must distinguish a missing row from a failed DB read. */
export async function getCredentialStrict(
  provider: Provider,
  field: string,
  envVar: string,
  organizationId: string,
): Promise<string | null> {
  return resolveCredentialStrict({
    field,
    organizationId,
    defaultOrganizationId: DEFAULT_ORGANIZATION_ID,
    loadProvider: () => loadProvider(provider, organizationId, true),
    environmentValue: () => process.env[envVar],
  });
}

/**
 * Where did each field come from? Useful for the admin UI status
 * badges so the operator can tell "configured (from DB)" from
 * "configured (from env var)".
 */
export type CredentialSource = "db" | "env" | "none";

export async function getCredentialSource(
  provider: Provider,
  field: string,
  envVar: string,
  organizationId: string,
): Promise<{ source: CredentialSource; hint?: string }> {
  const row = await loadProvider(provider, organizationId);
  const fromDb = row[field]?.trim();
  if (fromDb) {
    return { source: "db", hint: lastFour(fromDb) };
  }
  const fromEnv =
    organizationId === DEFAULT_ORGANIZATION_ID
      ? process.env[envVar]?.trim()
      : undefined;
  if (fromEnv) {
    return { source: "env", hint: lastFour(fromEnv) };
  }
  return { source: "none" };
}

/**
 * Save (or update) a provider's credentials. Empty strings are
 * stripped so saving "" doesn't accidentally overwrite a real value
 * with garbage; use deleteCredential to actually clear a field.
 */
export async function saveCredentials(
  provider: Provider,
  fields: Record<string, string>,
  updatedBy: string | null,
  organizationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const cleaned = Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => [key, (value ?? "").trim()])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  if (Object.keys(cleaned).length === 0) {
    return { ok: false, error: "No credential fields were provided." };
  }

  const { error } = await getServiceSupabase().rpc(
    "merge_integration_credentials",
    {
      p_organization_id: organizationId,
      p_provider: provider,
      p_fields: cleaned,
      p_updated_by: updatedBy,
    },
  );
  if (error) {
    return { ok: false, error: "Credentials could not be saved right now." };
  }
  clearCredentialsCache(provider, organizationId);
  return { ok: true };
}

/**
 * Remove specific fields from a provider's stored credentials. The default
 * organization may then use its legacy environment fallback; every other
 * organization becomes unconfigured. Use this when an admin clicks "clear".
 */
export async function clearCredentialFields(
  provider: Provider,
  fields: string[],
  organizationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getServiceSupabase().rpc(
    "clear_integration_credentials",
    {
      p_organization_id: organizationId,
      p_provider: provider,
      p_fields: fields,
    },
  );
  if (error) {
    return { ok: false, error: "Credentials could not be cleared right now." };
  }
  clearCredentialsCache(provider, organizationId);
  return { ok: true };
}

function clearCredentialsCache(
  provider: Provider | undefined,
  organizationId: string,
): void {
  if (provider) cache.delete(cacheKey(provider, organizationId));
  else cache.clear();
}

function lastFour(s: string): string {
  if (s.length <= 4) return "*".repeat(s.length);
  return `…${s.slice(-4)}`;
}
