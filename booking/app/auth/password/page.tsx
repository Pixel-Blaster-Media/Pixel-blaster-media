import type { Metadata } from "next";
import Link from "next/link";

import PasswordSignInForm from "./PasswordSignInForm";

export const metadata: Metadata = {
  title: "Sign in with password",
};

export default function PasswordSignInPage() {
  return (
    <div className="mx-auto max-w-md space-y-6 py-8">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
          Pixel Blaster
        </p>
        <h1 className="mt-2 text-3xl font-bold text-white">
          Sign in with password
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          Set your password in Supabase first (Authentication → Users → click
          your user → Edit user → set password). Then sign in here.
        </p>
      </header>
      <PasswordSignInForm />
      <p className="text-xs text-ink-muted">
        Prefer a magic link?{" "}
        <Link href="/auth/sign-in" className="text-brand-light underline">
          Use the magic-link form
        </Link>
        .
      </p>
    </div>
  );
}
