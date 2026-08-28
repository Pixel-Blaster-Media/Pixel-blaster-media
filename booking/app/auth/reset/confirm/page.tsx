import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  RECOVERY_GRANT_COOKIE,
  verifyRecoveryGrant,
} from "@/lib/auth/recovery-flow";
import {
  getRequestVerifiedIdentity,
} from "@/lib/auth/request-verified-identity";
import { supabaseSessionExpiryState } from "@/lib/auth/session-cookie-expiry";

import ResetConfirmForm from "./ResetConfirmForm";

export const metadata: Metadata = { title: "Set a new password" };
export const dynamic = "force-dynamic";

export default async function ResetConfirmPage() {
  const cookieStore = await cookies();
  if (
    supabaseSessionExpiryState(
      cookieStore.getAll(),
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ) === "near_expiry"
  ) {
    redirect("/auth/refresh?next=%2Fauth%2Freset%2Fconfirm");
  }

  let userId: string | null = null;
  let accessUnavailable = false;
  try {
    const identity = await getRequestVerifiedIdentity();
    if (identity.kind === "authenticated") {
      userId = identity.user.id;
    } else if (identity.kind !== "missing") {
      accessUnavailable = true;
    }
  } catch (error) {
    console.error(
      "[auth/reset/confirm] initial authorization lookup failed",
      error instanceof Error ? error.message : "unknown error",
    );
    accessUnavailable = true;
  }
  if (accessUnavailable) redirect("/auth/access-unavailable");

  let hasRecoveryGrant = false;
  try {
    hasRecoveryGrant = Boolean(
      userId &&
        verifyRecoveryGrant(
          cookieStore.get(RECOVERY_GRANT_COOKIE)?.value,
          userId,
        ),
    );
  } catch (error) {
    console.error(
      "[auth/reset/confirm] recovery grant verification failed",
      error instanceof Error ? error.message : "unknown error",
    );
    redirect("/auth/access-unavailable");
  }

  if (!userId || !hasRecoveryGrant) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-realtor-text">
          Link expired or invalid
        </h1>
        <p className="text-sm text-realtor-muted">
          Password-reset links expire after about an hour and can only be used
          once. Please{" "}
          <Link href="/auth/reset" className="text-realtor-primary underline">
            request a fresh link
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-realtor-primary">
          One last step
        </p>
        <h1 className="mt-2 text-2xl font-bold text-realtor-text">
          Set a new password
        </h1>
        <p className="mt-1 text-sm text-realtor-muted">
          Pick something at least 8 characters and save it within 15 minutes of
          opening this page. You&apos;ll be signed in automatically once you save.
        </p>
      </header>
      <ResetConfirmForm />
    </div>
  );
}
