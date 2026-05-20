"use server";

import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  clearCredentialFields,
  getCredential,
  getCredentialSource,
  type Provider,
  saveCredentials,
} from "@/lib/integrations/credentials";
import { sendEmail } from "@/lib/email/resend";
import { testPortalCredentials } from "@/lib/integrations/iguide/portal-client";
import {
  buildAuthorizeUrl as buildGoogleAuthorizeUrl,
  revokeToken as revokeGoogleToken,
} from "@/lib/integrations/google-calendar/oauth";
import {
  deleteGoogleCalendarConnection,
  getGoogleCalendarClient,
  getGoogleCalendarConnection,
} from "@/lib/integrations/google-calendar/client";
import { buildAuthorizeUrl } from "@/lib/integrations/quickbooks/oauth";
import { getServiceSupabase } from "@/lib/supabase/server";

const STATE_COOKIE = "qbo_oauth_state";
const GOOGLE_STATE_COOKIE = "google_oauth_state";

type MutableCookieStore = {
  set(
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: "lax";
      path: string;
      maxAge: number;
    },
  ): void;
};

/**
 * Kick off the QuickBooks OAuth consent flow.
 *
 * We mint a CSRF token, drop it in a short-lived cookie, and redirect
 * the admin to Intuit's consent page. The callback route validates the
 * returned `state` against this cookie.
 */
export async function startQuickBooksConnect(): Promise<void> {
  await requireAdmin();

  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!clientId || !appUrl) {
    throw new Error(
      "QUICKBOOKS_CLIENT_ID and NEXT_PUBLIC_APP_URL must be set before connecting.",
    );
  }

  const state = randomBytes(24).toString("hex");
  const cookieStore = (await cookies()) as unknown as MutableCookieStore;
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60, // 10 min — long enough to complete consent, short enough to be safe
  });

  const redirectUri = new URL(
    "/api/integrations/quickbooks/callback",
    appUrl,
  ).toString();

  const authUrl = buildAuthorizeUrl({ clientId, redirectUri, state });
  redirect(authUrl);
}

/**
 * Disconnect wipes the connection row. The admin will need to re-consent
 * to reconnect. We intentionally don't revoke the refresh token with
 * Intuit — local deletion is sufficient, and revocation can fail if the
 * token is already expired.
 */
export async function disconnectQuickBooks(): Promise<void> {
  const admin = await requireAdmin();
  const supabase = getServiceSupabase();
  await supabase
    .from("quickbooks_connection")
    .delete()
    .eq("organization_id", admin.organizationId);
  revalidatePath("/admin/settings/integrations");
}

/**
 * Send a diagnostic email via the Resend wrapper. Returns the exact
 * outcome the wrapper reports — success ids, skip reasons, or the raw
 * Resend error — so the admin can paste it into chat and diagnose
 * without ever sharing the API key.
 */
export async function sendTestEmail(
  to: string,
): Promise<{
  ok: boolean;
  skipped?: boolean;
  id?: string;
  error?: string;
  /** What the server saw in env — helps when "skipped" is the answer. */
  config: {
    resendApiKeyPresent: boolean;
    emailFrom: string | null;
  };
}> {
  const admin = await requireAdmin();

  const trimmed = to.trim();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return {
      ok: false,
      error: "Enter a valid email address.",
      config: {
        resendApiKeyPresent: !!(await getCredential(
          "resend",
          "api_key",
          "RESEND_API_KEY",
          admin.organizationId,
        )),
        emailFrom: process.env.EMAIL_FROM ?? null,
      },
    };
  }

  const res = await sendEmail({
    to: trimmed,
    subject: "Pixel Blaster — test email",
    organizationId: admin.organizationId,
    html: `
      <!doctype html>
      <html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0b0f10;color:#e8eef0;padding:32px">
        <h1 style="color:#fff;margin:0 0 12px">It works.</h1>
        <p>This is a test email from your Pixel Blaster booking admin.</p>
        <p>If you got this, Resend is wired up correctly.</p>
        <p style="color:#8a979c;font-size:12px;margin-top:24px">Sent ${new Date().toISOString()}</p>
      </body></html>
    `,
  });

  return {
    ...res,
    config: {
      resendApiKeyPresent: !!(await getCredential(
        "resend",
        "api_key",
        "RESEND_API_KEY",
        admin.organizationId,
      )),
      emailFrom: process.env.EMAIL_FROM ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Generic per-provider credential save / clear actions, used by the
// per-integration forms on the page. Validates every field passed in is
// in the provider's allowlist so the form can't be coaxed into writing
// arbitrary keys.
// ---------------------------------------------------------------------------

const ALLOWED_FIELDS: Record<Provider, string[]> = {
  admin_settings: ["today_command_preferences"],
  fotello: ["api_key"],
  google_maps: ["api_key"],
  iguide: ["app_id", "app_token", "webhook_secret"],
  openai: ["api_key", "model"],
  resend: ["api_key"],
};

function isProvider(value: string): value is Provider {
  return (
    value === "admin_settings" ||
    value === "fotello" ||
    value === "google_maps" ||
    value === "iguide" ||
    value === "openai" ||
    value === "resend"
  );
}

export async function saveIntegrationCredentials(
  provider: string,
  rawFields: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin();
  if (!isProvider(provider)) {
    return { ok: false, error: `Unknown provider "${provider}".` };
  }

  const allowed = new Set(ALLOWED_FIELDS[provider]);
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawFields)) {
    if (!allowed.has(k)) continue;
    if (typeof v !== "string") continue;
    fields[k] =
      provider === "iguide" && k === "webhook_secret"
        ? normalizeIGuideWebhookSecret(v)
        : v;
  }

  if (Object.keys(fields).length === 0) {
    return { ok: false, error: "No valid fields to save." };
  }

  const result = await saveCredentials(
    provider,
    fields,
    admin.userId,
    admin.organizationId,
  );
  if (!result.ok) return result;
  revalidatePath("/admin/settings/integrations");
  return { ok: true };
}

export async function clearIntegrationCredentials(
  provider: string,
  fields: string[],
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin();
  if (!isProvider(provider)) {
    return { ok: false, error: `Unknown provider "${provider}".` };
  }
  const allowed = new Set(ALLOWED_FIELDS[provider]);
  const valid = fields.filter((f) => allowed.has(f));
  if (valid.length === 0) {
    return { ok: false, error: "Nothing valid to clear." };
  }
  const result = await clearCredentialFields(
    provider,
    valid,
    admin.organizationId,
  );
  if (!result.ok) return result;
  revalidatePath("/admin/settings/integrations");
  return { ok: true };
}

export async function testIGuideCredentials(): Promise<{
  ok: boolean;
  error?: string;
  appIdLast4?: string;
}> {
  const admin = await requireAdmin();
  const result = await testPortalCredentials({
    organizationId: admin.organizationId,
  });
  if (!result.ok || !result.data?.appId) {
    return {
      ok: false,
      error:
        result.error ??
        "iGUIDE did not accept the saved App ID and App Token.",
    };
  }
  return {
    ok: true,
    appIdLast4: result.data.appId.slice(-4),
  };
}

export async function testOpenAICredentials(): Promise<{
  ok: boolean;
  error?: string;
  model?: string;
  source: "company" | "platform" | "none";
}> {
  const admin = await requireAdmin();
  const apiKey = await getCredential(
    "openai",
    "api_key",
    "OPENAI_API_KEY",
    admin.organizationId,
  );
  const model =
    (await getCredential(
      "openai",
      "model",
      "OPENAI_ASSISTANT_MODEL",
      admin.organizationId,
    )) ||
    process.env.OPENAI_MODEL ||
    "gpt-5.4-mini";

  if (!apiKey) {
    return {
      ok: false,
      error: "No OpenAI API key is saved for this company and no platform fallback is configured.",
      source: "none",
    };
  }

  const source =
    (await getCredentialSource(
      "openai",
      "api_key",
      "OPENAI_API_KEY",
      admin.organizationId,
    )).source === "db"
      ? "company"
      : "platform";

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: "Reply with exactly: ok",
        max_output_tokens: 20,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return {
        ok: false,
        error: `OpenAI rejected the test (${res.status}). ${body.slice(0, 220)}`,
        model,
        source,
      };
    }

    return { ok: true, model, source };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "OpenAI test failed.",
      model,
      source,
    };
  }
}

function normalizeIGuideWebhookSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("secret")?.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Kick off the Google Calendar OAuth consent flow. Same pattern as the
 * QuickBooks connect action: mint a CSRF token, drop it in a short-lived
 * cookie, redirect to Google's consent screen. The callback route
 * validates the echoed state against the cookie.
 */
export async function startGoogleCalendarConnect(): Promise<void> {
  await requireAdmin();

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!clientId || !appUrl) {
    throw new Error(
      "GOOGLE_CLIENT_ID and NEXT_PUBLIC_APP_URL must be set before connecting.",
    );
  }

  const state = randomBytes(24).toString("hex");
  const cookieStore = (await cookies()) as unknown as MutableCookieStore;
  cookieStore.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });

  const redirectUri = new URL(
    "/api/integrations/google-calendar/callback",
    appUrl,
  ).toString();

  const authUrl = buildGoogleAuthorizeUrl({ clientId, redirectUri, state });
  redirect(authUrl);
}

/**
 * Disconnect wipes the row. Best-effort call to Google's revoke endpoint
 * so the refresh token is invalidated on Google's side too — any cached
 * access tokens stop working immediately.
 */
export async function disconnectGoogleCalendar(): Promise<void> {
  const admin = await requireAdmin();
  const conn = await getGoogleCalendarConnection({
    organizationId: admin.organizationId,
  });
  if (conn?.refresh_token) {
    await revokeGoogleToken(conn.refresh_token);
  }

  await deleteGoogleCalendarConnection({ organizationId: admin.organizationId });
  revalidatePath("/admin/settings/integrations");
}

export async function testGoogleCalendarConnection(): Promise<{
  ok: boolean;
  eventUrl?: string;
  calendarId?: string;
  error?: string;
  config: {
    clientIdPresent: boolean;
    clientSecretPresent: boolean;
    connectionPresent: boolean;
  };
}> {
  const admin = await requireAdmin();

  const conn = await getGoogleCalendarConnection({
    organizationId: admin.organizationId,
  });

  const config = {
    clientIdPresent: Boolean(process.env.GOOGLE_CLIENT_ID),
    clientSecretPresent: Boolean(process.env.GOOGLE_CLIENT_SECRET),
    connectionPresent: Boolean(conn),
  };

  if (!config.clientIdPresent || !config.clientSecretPresent) {
    return {
      ok: false,
      error:
        "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set before calendar sync can work.",
      config,
    };
  }

  if (!config.connectionPresent) {
    return {
      ok: false,
      error: "Google Calendar is not connected yet. Click Connect first.",
      config,
    };
  }

  try {
    const client = await getGoogleCalendarClient({
      organizationId: admin.organizationId,
    });
    if (!client) {
      return {
        ok: false,
        error: "Google Calendar client could not be created.",
        config,
      };
    }

    const start = new Date(Date.now() + 15 * 60_000);
    const end = new Date(start.getTime() + 15 * 60_000);
    const event = await client.createEvent({
      summary: "Pixel Blaster calendar sync test",
      description:
        "This short test event was created from the booking admin integrations page. You can delete it.",
      startISO: start.toISOString(),
      endISO: end.toISOString(),
    });

    return {
      ok: true,
      eventUrl: event.htmlLink,
      calendarId: client.calendarId,
      config,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      config,
    };
  }
}

/**
 * Save the QB Service Item that all invoice lines will reference.
 * Fetched from QB earlier in the page via a server action; the admin
 * picks one from the dropdown and we persist the id.
 */
export async function setDefaultItem(
  itemId: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin();
  if (!itemId || !/^\d+$/.test(itemId)) {
    return { ok: false, error: "Invalid item id." };
  }
  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("quickbooks_connection")
    .update({ default_item_id: itemId })
    .eq("organization_id", admin.organizationId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/settings/integrations");
  return { ok: true };
}
