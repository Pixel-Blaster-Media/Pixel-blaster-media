"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { clearRecoverySession } from "@/lib/auth/clear-recovery-session";
import {
  RECOVERY_GRANT_COOKIE,
  verifyRecoveryGrant,
} from "@/lib/auth/recovery-flow";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";

export interface ResetConfirmState {
  error?: string;
  needsFreshLink?: boolean;
}

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

  let supabase: Awaited<ReturnType<typeof getServerSupabase>> | null = null;
  try {
  supabase = await getServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  const cookieStore = await cookies();
  const grant = user
    ? verifyRecoveryGrant(
        cookieStore.get(RECOVERY_GRANT_COOKIE)?.value,
        user.id,
      )
    : null;
  if (userError || !user || !grant) {
    await clearRecoverySession(supabase);
    return {
      error: "Your reset authorization expired. Request a fresh password-reset link.",
      needsFreshLink: true,
    };
  }

  const consumed = await getServiceSupabase().rpc(
    "consume_auth_recovery_grant",
    { p_jti_hash: grant.jtiHash, p_user_id: user.id },
  );
  if (consumed.error) {
    console.error("[auth/reset/confirm] grant consumption failed", consumed.error.code);
    await clearRecoverySession(supabase);
    return {
      error: "We couldn't verify this reset. Request a fresh password-reset link.",
      needsFreshLink: true,
    };
  }
  if (!consumed.data) {
    await clearRecoverySession(supabase);
    return {
      error: "This reset authorization was already used or expired. Request a fresh link.",
      needsFreshLink: true,
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("[auth/reset/confirm] updateUser failed", error.message);
    await clearRecoverySession(supabase);
    return {
      error: "Could not set the new password. Request a fresh reset link and try again.",
      needsFreshLink: true,
    };
  }

  cookieStore.set(RECOVERY_GRANT_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/auth/reset/confirm",
    maxAge: 0,
  });
  } catch (error) {
    console.error(
      "[auth/reset/confirm] reset transport failed",
      error instanceof Error ? error.message : "unknown error",
    );
    await clearRecoverySession(supabase);
    return {
      error:
        "We couldn't complete this reset. Request a fresh password-reset link before trying again.",
      needsFreshLink: true,
    };
  }
  redirect("/auth/continue?password_updated=1");
}
