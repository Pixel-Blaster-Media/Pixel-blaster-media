"use server";

import { redirect } from "next/navigation";

import { createRecoveryFlowToken } from "@/lib/auth/recovery-flow";
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

  try {
    const recoveryCallback = new URL("/auth/recovery/callback", appUrl);
    recoveryCallback.searchParams.set("flow", createRecoveryFlowToken(email));
    const redirectTo = recoveryCallback.toString();

    const supabase = await getServerSupabase();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      console.warn("[auth/reset] resetPasswordForEmail failed", error.message);
      return {
        error:
          "We couldn't send a reset email right now. Please wait a moment and try again.",
      };
    }
  } catch (error) {
    console.error(
      "[auth/reset] reset request transport failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return {
      error:
        "We couldn't send a reset email right now. Please wait a moment and try again.",
    };
  }

  redirect(
    `/auth/reset?sent=1&email=${encodeURIComponent(email)}`,
  );
}
