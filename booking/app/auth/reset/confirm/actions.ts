"use server";

import { redirect } from "next/navigation";

import { getServerSupabase } from "@/lib/supabase/server";

export interface ResetConfirmState {
  error?: string;
}

/**
 * After the user lands on /auth/reset/confirm (they've exchanged the
 * recovery code for a session cookie via /auth/callback), they submit
 * a new password here. We call supabase.auth.updateUser({ password }),
 * which works for the current session — no old-password verification
 * required, because the recovery link IS the verification.
 *
 * On success we redirect to /portal (the signed-in home). They stay
 * signed in with the session that was minted during the recovery
 * exchange.
 */
export async function setNewPassword(
  _prev: ResetConfirmState | null,
  formData: FormData,
): Promise<ResetConfirmState> {
  const password = ((formData.get("password") as string | null) ?? "").toString();
  const confirm = ((formData.get("confirm") as string | null) ?? "").toString();

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirm) {
    return { error: "Passwords don't match — re-enter to confirm." };
  }

  const supabase = getServerSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return {
      error:
        "Your reset session expired. Request a fresh link from /auth/reset.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("[auth/reset/confirm] updateUser failed", error.message);
    return { error: `Could not set the new password: ${error.message}` };
  }

  redirect("/portal?password_updated=1");
}
