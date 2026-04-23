import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getServerSupabase } from "@/lib/supabase/server";

import ResetConfirmForm from "./ResetConfirmForm";

export const metadata: Metadata = { title: "Set a new password" };
export const dynamic = "force-dynamic";

/**
 * Landing page after the user clicks the recovery link in their email.
 *
 * Flow:
 *   1. Reset email → `/auth/callback?next=/auth/reset/confirm`
 *   2. /auth/callback exchanges the Supabase code for a session cookie
 *   3. User lands here with an authenticated (recovery) session
 *   4. They set a new password via the form below
 *
 * If they land here without a session (link expired, direct navigation,
 * etc.), we show a soft error with a way to restart.
 */
export default async function ResetConfirmPage() {
  const supabase = getServerSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16">
        <h1 className="text-2xl font-bold text-white">Link expired or invalid</h1>
        <p className="text-sm text-ink-muted">
          Password-reset links expire after about an hour, and can only be
          used once. Please{" "}
          <Link href="/auth/reset" className="text-brand-light underline">
            request a fresh link
          </Link>
          .
        </p>
      </div>
    );
  }

  // Double-check the session actually belongs to a known profile so we
  // don't let someone with a stale cookie change a random password.
  let userId: string | null = null;
  try {
    const parts = session.access_token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { sub?: string };
    userId = payload.sub ?? null;
  } catch {
    userId = null;
  }
  if (!userId) redirect("/auth/reset");

  return (
    <div className="mx-auto max-w-md space-y-6 py-16">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
          One last step
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">
          Set a new password
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Pick something at least 8 characters. You&apos;ll be signed in
          automatically once you save.
        </p>
      </header>

      <ResetConfirmForm />
    </div>
  );
}
