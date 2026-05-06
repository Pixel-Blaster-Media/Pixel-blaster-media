import type { Metadata } from "next";
import Link from "next/link";

import SignInForm from "../sign-in/SignInForm";

export const metadata: Metadata = {
  title: "Magic link sign in",
};

export default async function MagicLinkSignInPage({
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
        <h1 className="mt-2 text-3xl font-bold text-white">
          Email me a sign-in link
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          Use this if you cannot get into your account with a password.
        </p>
      </header>
      <SignInForm next={params.next} />
      <p className="text-xs text-ink-muted">
        Know your password?{" "}
        <Link
          href={`/auth/sign-in${params.next ? `?next=${encodeURIComponent(params.next)}` : ""}`}
          className="text-brand-light underline"
        >
          Sign in with password
        </Link>
        .
      </p>
    </div>
  );
}
