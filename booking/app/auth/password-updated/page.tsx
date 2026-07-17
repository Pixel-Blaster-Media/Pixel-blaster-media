import type { Metadata } from "next";
import Link from "next/link";

import { safePostAuthPath } from "@/lib/auth/account-destination";

export const metadata: Metadata = {
  title: "Password updated",
};

export default async function PasswordUpdatedPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const destination = safePostAuthPath(params.next ?? null);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
          Password updated
        </p>
        <h1 className="mt-2 text-3xl font-bold text-realtor-text">
          Your new password is ready.
        </h1>
        <p className="mt-2 text-sm leading-6 text-realtor-muted">
          Your account stayed signed in. Continue to the workspace linked to your
          verified account.
        </p>
      </header>

      <Link
        href={destination}
        className="inline-flex min-h-11 items-center justify-center rounded-full bg-realtor-primary px-5 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-realtor-primary"
      >
        Continue to workspace
      </Link>
    </div>
  );
}
