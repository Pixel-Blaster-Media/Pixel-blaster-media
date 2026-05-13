import Link from "next/link";

const SETTINGS_SECTIONS = [
  {
    href: "/admin/settings/availability",
    title: "Availability",
    description: "Set working hours, closed days, and private calendar blocks.",
  },
  {
    href: "/admin/settings/pricing",
    title: "Pricing",
    description: "Manage packages, add-ons, media badges, durations, and square-footage rules.",
  },
  {
    href: "/admin/settings/integrations",
    title: "Integrations",
    description: "Connect Google Calendar, email, QuickBooks, iGUIDE, and delivery tools.",
  },
] as const;

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-lg shadow-realtor-text/10">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-realtor-primary/80">
          Admin
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-realtor-text md:text-3xl">
          Settings
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-realtor-muted">
          Control how booking, pricing, availability, and connected tools work.
          We can add more business preferences here as the system grows.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        {SETTINGS_SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/80 p-4 shadow-sm shadow-realtor-text/5 transition hover:border-realtor-primary/35 hover:bg-realtor-surface"
          >
            <h2 className="text-sm font-semibold text-realtor-text">
              {section.title}
            </h2>
            <p className="mt-2 text-xs leading-5 text-realtor-muted">
              {section.description}
            </p>
          </Link>
        ))}
      </section>

      <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/80 p-5 shadow-sm shadow-realtor-text/5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary/80">
              Booking flow
            </p>
            <h2 className="mt-2 text-lg font-semibold text-realtor-text">
              Manual confirmation
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-realtor-muted">
              Current setup: bookings are confirmed automatically when the
              schedule is free, so the Inbox tab is hidden. Later, this setting
              can become a real toggle for businesses that want to approve each
              request before it hits the calendar.
            </p>
          </div>
          <span className="rounded-full border border-realtor-primary/20 bg-realtor-primary/10 px-3 py-1 text-xs font-semibold text-realtor-primary">
            Auto-confirm on
          </span>
        </div>
      </section>
    </div>
  );
}
