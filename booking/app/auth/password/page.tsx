import type { Metadata } from "next";
import Link from "next/link";

import PasswordSignInForm from "./PasswordSignInForm";

export const metadata: Metadata = {
  title: "Sign in with password",
};

export default async function PasswordSignInPage({
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
          Sign in with password
        </h1>
        <p className="mt-2 text-sm text-realtor-muted">
          Use your email and password to open your bookings, media, and admin
          tools.
        </p>
      </header>
      <PasswordSignInForm next={params.next} />
      <p className="text-xs text-realtor-muted">
        Prefer a magic link?{" "}
        <Link
          href={`/auth/magic${params.next ? `?next=${encodeURIComponent(params.next)}` : ""}`}
          className="text-realtor-primary underline"
        >
          Use the magic-link form
        </Link>
        .
      </p>
    </div>
  );
}
