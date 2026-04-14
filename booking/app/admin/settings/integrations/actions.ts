"use server";

import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { buildAuthorizeUrl } from "@/lib/integrations/quickbooks/oauth";
import { getServiceSupabase } from "@/lib/supabase/server";

const STATE_COOKIE = "qbo_oauth_state";

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
  cookies().set(STATE_COOKIE, state, {
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
  await requireAdmin();
  const supabase = getServiceSupabase();
  await supabase.from("quickbooks_connection").delete().eq("id", 1);
  revalidatePath("/admin/settings/integrations");
}

/**
 * Save the QB Service Item that all invoice lines will reference.
 * Fetched from QB earlier in the page via a server action; the admin
 * picks one from the dropdown and we persist the id.
 */
export async function setDefaultItem(
  itemId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  if (!itemId || !/^\d+$/.test(itemId)) {
    return { ok: false, error: "Invalid item id." };
  }
  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("quickbooks_connection")
    .update({ default_item_id: itemId })
    .eq("id", 1);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/settings/integrations");
  return { ok: true };
}
