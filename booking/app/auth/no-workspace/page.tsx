import type { Metadata } from "next";
import Link from "next/link";

import { signOut } from "@/lib/auth/sign-out";

export const metadata: Metadata = {
  title: "Workspace not linked",
};

export default function NoWorkspacePage() {
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
          Account needs attention
        </p>
        <h1 className="mt-2 text-3xl font-bold text-realtor-text">
          This account isn&apos;t linked to a workspace.
        </h1>
        <p className="mt-2 text-sm leading-6 text-realtor-muted">
          We signed you in, but we could not find a photography-company
          membership or an active realtor profile. We will not guess which
          workspace you should access.
        </p>
      </header>

      <section className="space-y-4 rounded-2xl border border-realtor-primary/12 bg-realtor-surface-muted/60 p-5 text-sm leading-6 text-realtor-muted">
        <div>
          <h2 className="font-semibold text-realtor-text">
            Joining a photography company?
          </h2>
          <p className="mt-1">
            Open the owner invitation that was emailed to you. Company access
            is invitation-only during beta.
          </p>
        </div>
        <div>
          <h2 className="font-semibold text-realtor-text">
            Booking as a realtor or agent?
          </h2>
          <p className="mt-1">
            An existing sign-in cannot be linked to a company automatically.
            Contact support or the photography company so they can verify the
            account before provisioning access.
          </p>
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <a
          href="mailto:info@pixelblastermedia.com"
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-realtor-primary/20 bg-white px-4 py-2 text-sm font-semibold text-realtor-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-realtor-primary"
        >
          Email support
        </a>
        <form action={signOut}>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-realtor-primary"
          >
            Sign out and try another account
          </button>
        </form>
        <Link
          href="/auth/sign-in"
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-realtor-primary/20 bg-white px-4 py-2 text-sm font-semibold text-realtor-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-realtor-primary"
        >
          Back to login options
        </Link>
      </div>
    </div>
  );
}
