import type { Metadata } from "next";
import Link from "next/link";

import OAuthButtons from "../oauth/OAuthButtons";
import PasswordSignInForm from "../password/PasswordSignInForm";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; oauth_error?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-realtor-primary">
          Pixel Blaster
        </p>
        <h1 className="mt-2 text-3xl font-bold text-realtor-text">Sign in</h1>
        <p className="mt-2 text-sm text-realtor-muted">
          Use your email and password to open your bookings, media, and admin
          tools.
        </p>
      </header>
      {params.oauth_error ? (
        <p
          role="alert"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {params.oauth_error === "apple"
            ? "Apple sign-in is not ready yet. Use email/password for now, or enable Apple in Supabase Auth first."
            : "Google sign-in is not ready yet. Use email/password for now, or enable Google in Supabase Auth first."}
        </p>
      ) : null}
      <OAuthButtons mode="sign-in" next={params.next ?? "/admin"} />
      <PasswordSignInForm next={params.next} />
      <div className="space-y-2 text-xs text-realtor-muted">
        <p>
          Forgot your password?{" "}
          <Link href="/auth/reset" className="text-realtor-primary underline">
            Send yourself a reset link
          </Link>
          .
        </p>
        <p>
          Need a one-time email link?{" "}
          <Link
            href={`/auth/magic${params.next ? `?next=${encodeURIComponent(params.next)}` : ""}`}
            className="text-realtor-primary underline"
          >
            Use magic link sign-in
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
