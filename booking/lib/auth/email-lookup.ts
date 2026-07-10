import "server-only";

import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";

/**
 * Check whether an email address already has a profile / auth user.
 *
 * Used internally to choose the sign-in or create-account path after a public
 * booking form is submitted. It must never be exported directly to the client.
 */
export async function emailHasAccount(rawEmail: string): Promise<boolean> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) return false;

  const supabase = getServiceSupabase();

  // `profiles.email` mirrors `auth.users.email` (populated by the
  // handle_new_auth_user trigger), so checking profiles is sufficient
  // and doesn't require admin-API listUsers pagination.
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[emailHasAccount] lookup failed", error.message);
    // Prefer "doesn't exist" on error so the form lets them attempt sign-up,
    // and any duplicate-key error surfaces on the actual submit instead.
    return false;
  }

  return !!data;
}
