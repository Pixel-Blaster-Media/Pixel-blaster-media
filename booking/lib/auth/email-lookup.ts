import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";

/**
 * Check whether an email address already has a profile / auth user.
 *
 * Used by the public booking form to decide whether to show "Sign in"
 * vs "Create a password". Not a security boundary — anyone could probe
 * this by trying to book — but we still keep the surface minimal:
 * bool in, bool out, no PII leaked.
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
