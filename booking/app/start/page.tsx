import type { Metadata } from "next";

import StartCompanyForm from "./StartCompanyForm";

export const metadata: Metadata = {
  title: "Start your booking system",
};

export default function StartPage() {
  return (
    <div className="realtor-theme mx-auto grid max-w-5xl gap-8 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-realtor-primary">
            Pixel platform beta
          </p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight text-realtor-text md:text-5xl">
            Create your booking account.
          </h1>
          <p className="mt-5 text-base leading-7 text-realtor-muted">
            Sign up first, then set up the business from inside your dashboard.
            Your workspace starts with a starter catalog, default availability,
            and a private admin area you can customize.
          </p>
        </div>

        <div className="realtor-elevated-panel rounded-3xl p-5">
          <p className="text-sm font-semibold text-realtor-text">
            What you get immediately
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-realtor-muted">
            <li>Own company booking link</li>
            <li>Admin dashboard for bookings, calendar, pricing, and realtors</li>
            <li>Starter catalog copied from Pixel Blaster&apos;s setup</li>
            <li>Your own company workspace, separate from Pixel&apos;s controls</li>
          </ul>
        </div>
      </section>

      <StartCompanyForm />
    </div>
  );
}
