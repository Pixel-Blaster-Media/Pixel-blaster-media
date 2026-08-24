"use server";

import { redirect } from "next/navigation";

import { safePostAuthPath } from "@/lib/auth/account-destination";
import {
  setSupabaseSessionCookie,
  signInWithPasswordREST,
} from "@/lib/auth/set-session-cookie";

export interface PasswordSignInState {
  error?: string;
}

/**
 * Exchanges credentials directly with Supabase, then verifies the issued
 * access token before installing the shared SSR session cookie.
 */
export async function signInWithPassword(
  _prev: PasswordSignInState | null,
  formData: FormData,
): Promise<PasswordSignInState> {
  const email = ((formData.get("email") as string | null) ?? "")
    .trim()
    .toLowerCase();
  const password = (
    (formData.get("password") as string | null) ?? ""
  ).toString();
  const next = safePostAuthPath(
    ((formData.get("next") as string | null) ?? "/admin").trim(),
  );

  if (!email || !password) {
    return { error: "Email and password are both required." };
  }

  const signIn = await signInWithPasswordREST(email, password);
  if (!signIn.ok) {
    if (signIn.error === "invalid_credentials") {
      return { error: "Email or password was not accepted." };
    }
    return { error: "The sign-in service is temporarily unavailable." };
  }

  try {
    await setSupabaseSessionCookie(signIn.tokens, email);
  } catch {
    return { error: "The authenticated session could not be established." };
  }

  redirect(next);
}
