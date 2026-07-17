import type { Metadata } from "next";
import Link from "next/link";

import {
  buildLoginContinuationPath,
  type LoginAudience,
} from "@/lib/auth/account-destination";

export const metadata: Metadata = {
  title: "Access check unavailable",
};

export default async function AccessUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ audience?: string; next?: string }>;
}) {
  const params = await searchParams;
  const audience: LoginAudience | null =
    params.audience === "company" || params.audience === "realtor"
      ? params.audience
      : null;
  const retryHref = audience
    ? buildLoginContinuationPath(audience, params.next ?? null)
    : "/auth/continue";

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
          Temporary access check problem
        </p>
        <h1 className="mt-2 text-3xl font-bold text-realtor-text">
          We couldn’t verify your access right now.
        </h1>
        <p className="mt-2 text-sm leading-6 text-realtor-muted">
          Your account and workspace have not been changed. The account service
          may be briefly unavailable; try the check again.
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <Link
          href={retryHref}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-realtor-primary"
        >
          Retry access check
        </Link>
        <Link
          href="/auth/sign-in"
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-realtor-primary/20 bg-white px-4 py-2 text-sm font-semibold text-realtor-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-realtor-primary"
        >
          Return to login options
        </Link>
      </div>
    </div>
  );
}
