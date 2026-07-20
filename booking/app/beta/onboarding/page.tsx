import type { Metadata } from "next";
import { cookies } from "next/headers";

import {
  BETA_INVITE_COOKIE,
  getActiveBetaCompanyInvite,
} from "@/lib/platform/beta-invites";

import BetaCompanyForm from "./BetaCompanyForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Private beta company setup",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function BetaCompanyOnboardingPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(BETA_INVITE_COOKIE)?.value ?? "";
  const invite = await getActiveBetaCompanyInvite(token);

  if (!invite) {
    return (
      <main className="min-h-screen bg-realtor-bg px-4 py-16 text-realtor-text">
        <section className="mx-auto max-w-xl rounded-3xl border border-realtor-primary/15 bg-realtor-surface p-7 shadow-xl shadow-realtor-text/10">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-realtor-primary">
            Private beta
          </p>
          <h1 className="mt-3 text-2xl font-semibold">
            This beta invitation is invalid, expired, used, or revoked
          </h1>
          <p className="mt-3 text-sm leading-6 text-realtor-muted">
            Ask the person who invited you to send a fresh private-beta link.
            No company was created from this page.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-realtor-bg px-4 py-10 text-realtor-text sm:py-16">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 px-1">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-realtor-primary">
            Invite-only beta
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Create your booking company
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-realtor-muted sm:text-base">
            This creates a company workspace separate from Pixel Blaster, with
            its own booking page, customers, availability, branding, and future
            integration connections.
          </p>
        </header>
        <BetaCompanyForm
          email={invite.email}
          expiresAt={invite.expiresAt}
        />
      </div>
    </main>
  );
}
