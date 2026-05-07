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
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-realtor-primary">
          Pixel Blaster
        </p>
        <h1 className="mt-2 text-3xl font-bold text-realtor-text">
          Email me a sign-in link
        </h1>
        <p className="mt-2 text-sm text-realtor-muted">
          Use this if you cannot get into your account with a password.
        </p>
      </header>
      <SignInForm next={params.next} />
      <p className="text-xs text-realtor-muted">
        Know your password?{" "}
        <Link
          href={`/auth/sign-in${params.next ? `?next=${encodeURIComponent(params.next)}` : ""}`}
          className="text-realtor-primary underline"
        >
          Sign in with password
        </Link>
        .
      </p>
    </div>
  );
}
