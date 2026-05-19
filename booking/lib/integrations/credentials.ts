import "server-only";

import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";
import { getServiceSupabase } from "@/lib/supabase/server";

/**
 * DB-backed credential store with env-var fallback.
 *
 * Each provider stores its credentials as a single jsonb row in
 * `integration_credentials`. The runtime resolution order for any
 * given key is:
 *
 *   1. The named field on the provider's row, if present and non-empty.
 *   2. The matching environment variable, as a fallback.
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

export type Provider = "fotello" | "iguide" | "openai" | "resend";

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
  organizationId = DEFAULT_ORGANIZATION_ID,
): Promise<Record<string, string>> {
  const key = cacheKey(provider, organizationId);
  const cached = cache.get(key);
  if (cached) return cached;

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("integration_credentials")
    .select("organization_id, provider, credentials")
    .eq("organization_id", organizationId)
    .eq("provider", provider)
    .maybeSingle<CredentialsRow>();

  if (error) {
    console.warn(
      `[credentials] DB read failed for ${provider} — falling back to env`,
      error.message,
    );
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
  organizationId = DEFAULT_ORGANIZATION_ID,
): Promise<string | null> {
  const row = await loadProvider(provider, organizationId);
  const fromDb = row[field]?.trim();
  if (fromDb) return fromDb;
  const fromEnv = process.env[envVar]?.trim();
  return fromEnv || null;
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
  organizationId = DEFAULT_ORGANIZATION_ID,
): Promise<{ source: CredentialSource; hint?: string }> {
  const row = await loadProvider(provider, organizationId);
  const fromDb = row[field]?.trim();
  if (fromDb) {
    return { source: "db", hint: lastFour(fromDb) };
  }
  const fromEnv = process.env[envVar]?.trim();
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
  organizationId = DEFAULT_ORGANIZATION_ID,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getServiceSupabase();

  const existing = await loadProvider(provider, organizationId);
  const merged: Record<string, string> = { ...existing };
  for (const [k, v] of Object.entries(fields)) {
    const trimmed = (v ?? "").trim();
    if (trimmed) merged[k] = trimmed;
  }

  const { error } = await supabase
    .from("integration_credentials")
    .upsert(
      {
        organization_id: organizationId,
        provider,
        credentials: merged,
        updated_by: updatedBy,
      },
      { onConflict: "organization_id,provider" },
    );

  if (error) return { ok: false, error: error.message };
  clearCredentialsCache(provider, organizationId);
  return { ok: true };
}

/**
 * Remove specific fields from a provider's stored credentials. After
 * this, those fields fall back to env vars again. Use this when the
 * admin clicks "clear" on a credential field.
 */
export async function clearCredentialFields(
  provider: Provider,
  fields: string[],
  organizationId = DEFAULT_ORGANIZATION_ID,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getServiceSupabase();
  const existing = await loadProvider(provider, organizationId);
  const next: Record<string, string> = { ...existing };
  for (const f of fields) delete next[f];

  if (Object.keys(next).length === 0) {
    // Drop the whole row when nothing's left.
    const { error } = await supabase
      .from("integration_credentials")
      .delete()
      .eq("organization_id", organizationId)
      .eq("provider", provider);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from("integration_credentials")
      .update({ credentials: next })
      .eq("organization_id", organizationId)
      .eq("provider", provider);
    if (error) return { ok: false, error: error.message };
  }
  clearCredentialsCache(provider, organizationId);
  return { ok: true };
}

export function clearCredentialsCache(
  provider?: Provider,
  organizationId = DEFAULT_ORGANIZATION_ID,
): void {
  if (provider) cache.delete(cacheKey(provider, organizationId));
  else cache.clear();
}

function lastFour(s: string): string {
  if (s.length <= 4) return "*".repeat(s.length);
  return `…${s.slice(-4)}`;
}
