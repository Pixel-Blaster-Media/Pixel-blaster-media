import SettingsHub from "./SettingsHub";

const SETTINGS_SECTIONS = [
  {
    href: "/admin/settings/business",
    title: "Business profile",
    description:
      "Edit the company name, booking handle, and brand colors for this organization.",
    details: [
      "Keep business identity separate per company.",
      "Reserve a clean booking handle for future branded links.",
      "Set the base colors future themes can use.",
    ],
  },
  {
    href: "/admin/settings/pricing",
    title: "Pricing",
    description:
      "Manage packages, add-ons, media badges, durations, and square-footage rules.",
    details: [
      "Update bundle prices and booking durations.",
      "Control à-la-carte services and optional add-ons.",
      "Tune square-footage pricing rules and package descriptions.",
    ],
  },
  {
    href: "/admin/settings/integrations",
    title: "Integrations",
    description: "Connect Google Calendar, email, QuickBooks, iGUIDE, and delivery tools.",
    details: [
      "Manage Google Calendar sync.",
      "Test confirmation emails and notification delivery.",
      "Connect QuickBooks, iGUIDE, and related delivery tools.",
    ],
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

      <SettingsHub sections={SETTINGS_SECTIONS} />

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
