"use server";

import { redirect } from "next/navigation";

import { getServerSupabase } from "@/lib/supabase/server";

export interface ResetRequestState {
  error?: string;
}

/**
 * "Forgot password" — send a Supabase recovery email.
 *
 * The email contains a one-time link that lands back on `/auth/callback`,
 * which exchanges the code for a session and forwards to
 * `/auth/reset/confirm` where they pick a new password.
 *
 * Security note: we always respond with a neutral "check your email"
 * message, even if the email doesn't exist. This prevents the endpoint
 * from being used to enumerate accounts.
 */
export async function requestPasswordReset(
  _prev: ResetRequestState | null,
  formData: FormData,
): Promise<ResetRequestState> {
  const email = ((formData.get("email") as string | null) ?? "")
    .trim()
    .toLowerCase();

  if (!email || !email.includes("@")) {
    return { error: "Enter a valid email address." };
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? "";
  if (!appUrl) {
    return {
      error:
        "NEXT_PUBLIC_APP_URL is not configured — contact support.",
    };
  }

  const redirectTo = `${appUrl}/auth/callback?next=${encodeURIComponent(
    "/auth/reset/confirm",
  )}`;

  const supabase = getServerSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) {
    // We don't surface account-existence errors to the user, but we DO
    // want to know about unexpected failures (e.g. SMTP down).
    console.warn("[auth/reset] resetPasswordForEmail failed", error.message);
  }

  redirect(
    `/auth/reset?sent=1&email=${encodeURIComponent(email)}`,
  );
}
