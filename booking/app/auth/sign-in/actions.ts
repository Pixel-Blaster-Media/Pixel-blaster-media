"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getServerSupabase } from "@/lib/supabase/server";

export interface SignInState {
  error?: string;
}

/**
 * Send a magic link to the user's email. Both admins and realtors use the
 * same flow — the role gate happens later in the /admin layout.
 *
 * `next` is preserved through the magic-link round-trip so the user lands
 * back on whatever they were trying to reach.
 */
export async function sendMagicLink(
  _prev: SignInState | null,
  formData: FormData,
): Promise<SignInState> {
  const email = ((formData.get("email") as string | null) ?? "")
    .trim()
    .toLowerCase();
  const next = ((formData.get("next") as string | null) ?? "/admin").trim();

  if (!email) {
    return { error: "Please enter your email." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "That email doesn't look right." };
  }

  const supabase = getServerSupabase();
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    headers().get("origin") ??
    `https://${headers().get("host") ?? "localhost:3000"}`;

  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", next);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: callback.toString(),
      // Don't auto-create accounts from a sign-in attempt — admins/realtors
      // are provisioned by the accept-booking flow or by hand. This prevents
      // random visitors from spinning up empty accounts via the form.
      shouldCreateUser: false,
    },
  });

  if (error) {
    // Don't leak whether the email exists — we get the same UX either way.
    console.warn("[auth] signInWithOtp returned error", error.message);
  }

  redirect(`/auth/check-email?email=${encodeURIComponent(email)}`);
}
