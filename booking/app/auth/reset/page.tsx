import type { Metadata } from "next";
import Link from "next/link";

import ResetRequestForm from "./ResetRequestForm";

export const metadata: Metadata = { title: "Reset password" };

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; email?: string }>;
}) {
  const params = await searchParams;
  const sent = params.sent === "1";

  return (
    <div className="mx-auto max-w-md space-y-6 py-16">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
          Forgot your password?
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">
          Send yourself a reset link
        </h1>
      </header>

      {sent ? (
        <div className="space-y-4">
          <p className="rounded-md border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-100">
            If an account exists for {params.email ?? "that email"}, a
            reset link is on its way. Check your inbox (and spam) — the link
            is good for about an hour.
          </p>
          <p className="text-xs text-ink-muted">
            Didn&apos;t receive it? Double-check the address for typos and{" "}
            <Link href="/auth/reset" className="text-brand-light underline">
              try again
            </Link>
            .
          </p>
        </div>
      ) : (
        <ResetRequestForm />
      )}

      <p className="border-t border-white/5 pt-4 text-xs text-ink-muted">
        Remembered it?{" "}
        <Link href="/auth/sign-in" className="text-brand-light underline">
          Sign in with your password
        </Link>
        .
      </p>
    </div>
  );
}
