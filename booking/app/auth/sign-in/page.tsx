import type { Metadata } from "next";
import Link from "next/link";

import PasswordSignInForm from "../password/PasswordSignInForm";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="mx-auto max-w-md space-y-6 py-8">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
          Pixel Blaster
        </p>
        <h1 className="mt-2 text-3xl font-bold text-white">Sign in</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Use your email and password to open your bookings, media, and admin
          tools.
        </p>
      </header>
      <PasswordSignInForm next={params.next} />
      <div className="space-y-2 text-xs text-ink-muted">
        <p>
          Forgot your password?{" "}
          <Link href="/auth/reset" className="text-brand-light underline">
            Send yourself a reset link
          </Link>
          .
        </p>
        <p>
          Need a one-time email link?{" "}
          <Link
            href={`/auth/magic${params.next ? `?next=${encodeURIComponent(params.next)}` : ""}`}
            className="text-brand-light underline"
          >
            Use magic link sign-in
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
