import type { Metadata } from "next";

import SignInForm from "./SignInForm";

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
          We'll email you a one-tap sign-in link. No password to remember.
        </p>
      </header>
      <SignInForm next={params.next} />
    </div>
  );
}
