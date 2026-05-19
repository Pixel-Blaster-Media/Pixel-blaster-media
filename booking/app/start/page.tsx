import type { Metadata } from "next";

import OAuthButtons from "@/app/auth/oauth/OAuthButtons";

import StartCompanyForm from "./StartCompanyForm";

export const metadata: Metadata = {
  title: "Start your booking system",
};

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ oauth_error?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="realtor-theme mx-auto grid max-w-5xl gap-8 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-realtor-primary">
            Pixel platform beta
          </p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight text-realtor-text md:text-5xl">
            Create your booking company.
          </h1>
          <p className="mt-5 text-base leading-7 text-realtor-muted">
            Start with your company name, booking link, colors, and owner
            login. Your workspace opens with a starter catalog, default
            availability, and a private admin area you can customize.
          </p>
        </div>

        <div className="realtor-elevated-panel rounded-3xl p-5">
          <p className="text-sm font-semibold text-realtor-text">
            What you get immediately
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-realtor-muted">
            <li>Your own company booking link</li>
            <li>Admin dashboard for bookings, calendar, pricing, and realtors</li>
            <li>Starter catalog copied from Pixel Blaster&apos;s setup</li>
            <li>Separate company workspace with its own settings and alerts</li>
          </ul>
        </div>
      </section>

      <div className="space-y-5">
        {params.oauth_error ? (
          <p
            role="alert"
            className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            {oauthErrorCopy(params.oauth_error)}
          </p>
        ) : null}
        <section className="realtor-elevated-panel rounded-3xl p-5 md:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary">
            Fast signup
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-realtor-text">
            Create with Google or Apple.
          </h2>
          <p className="mt-2 text-sm leading-6 text-realtor-muted">
            Fastest path: create your login, then finish branding from the
            setup checklist inside your dashboard.
          </p>
          <div className="mt-5">
            <OAuthButtons mode="signup" />
          </div>
        </section>
        <StartCompanyForm />
      </div>
    </div>
  );
}

function oauthErrorCopy(provider: string): string {
  if (provider === "apple") {
    return "Apple sign-in is not ready yet. Use email/password for now, or enable Apple in Supabase Auth first.";
  }
  return "Google sign-in is not ready yet. Use email/password for now, or enable Google in Supabase Auth first.";
}
