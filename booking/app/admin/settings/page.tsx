import SettingsHub from "./SettingsHub";
import { requireAdmin } from "@/lib/auth/require-admin";
import { hasPlatformAdminAccess } from "@/lib/auth/require-platform-admin";
import { getCredentialSource } from "@/lib/integrations/credentials";
import { getServiceSupabase } from "@/lib/supabase/server";
import CopyBookingLinkButton from "./business/CopyBookingLinkButton";
import {
  loadTodayCommandPreferences,
  saveTodayCommandPreferences,
} from "../today/actions";
import type { TodayCommandPreferences } from "../today/preferences";
import {
  publicVapidKey,
  pushNotificationsConfigured,
} from "@/lib/notifications/push";
import InstallAppCard from "./InstallAppCard";

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
    href: "/admin/settings/availability",
    title: "Availability",
    description:
      "Set working days, daily hours, and the windows realtors can book.",
    details: [
      "Control the public booking calendar.",
      "Keep schedule rules separate per company.",
      "Use calendar blocks for one-off time away.",
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

export default async function SettingsPage() {
  const admin = await requireAdmin();
  const [readiness, todayPreferences] = await Promise.all([
    loadLaunchReadiness(admin.organizationId),
    loadTodayCommandPreferences(admin.organizationId),
  ]);
  const sections = (await hasPlatformAdminAccess(admin))
    ? [
        ...SETTINGS_SECTIONS,
        {
          href: "/admin/settings/companies",
          title: "Companies",
          description:
            "Create a new photography company with its own booking handle, admin, catalog, and setup checklist.",
          details: [
            "Add the business and first admin account.",
            "Seed default working hours and copy a starter catalog.",
            "Keep client-company data separate for SaaS rollout.",
          ],
        },
      ]
    : SETTINGS_SECTIONS;

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

      <LaunchReadinessCard readiness={readiness} />

      <InstallAppCard
        publicKey={publicVapidKey()}
        configured={pushNotificationsConfigured()}
      />

      <TodayPreferencesCard preferences={todayPreferences} />

      <SettingsHub sections={sections} />
    </div>
  );
}

function TodayPreferencesCard({
  preferences,
}: {
  preferences: TodayCommandPreferences;
}) {
  return (
    <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-lg shadow-realtor-text/10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-realtor-primary/80">
            Today view
          </p>
          <h2 className="mt-2 text-xl font-semibold text-realtor-text">
            Daily command center reminders
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-realtor-muted">
            Choose what appears on the Today page. Keep it focused for the way
            you actually work in the morning.
          </p>
        </div>
        <a
          href="/admin/today"
          className="rounded-full border border-realtor-primary/20 bg-white px-4 py-2 text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
        >
          Open Today
        </a>
      </div>
      <form action={saveTodayCommandPreferences} className="mt-5 space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <TodayPreferenceToggle
            name="show_deliverables"
            label="Delivery reminders"
            description="Show unfinished media links and delivery checklist items."
            checked={preferences.showDeliverables}
          />
          <TodayPreferenceToggle
            name="show_agent_memory"
            label="Agent memory"
            description="Show saved realtor preferences and private reminder notes."
            checked={preferences.showAgentMemory}
          />
          <TodayPreferenceToggle
            name="show_route_warnings"
            label="Route spacing"
            description="Show tight gaps, city changes, and map links between shoots."
            checked={preferences.showRouteWarnings}
          />
          <TodayPreferenceToggle
            name="show_booking_notes"
            label="Booking notes"
            description="Show client notes and private notes on each shoot card."
            checked={preferences.showBookingNotes}
          />
          <TodayPreferenceToggle
            name="show_shoot_brief"
            label="AI shoot brief"
            description="Show the AI-generated shoot-day plan panel."
            checked={preferences.showShootBrief}
          />
        </div>
        <button
          type="submit"
          className="rounded-full bg-realtor-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-realtor-text/10 transition hover:bg-realtor-primary/90"
        >
          Save Today preferences
        </button>
      </form>
    </section>
  );
}

function TodayPreferenceToggle({
  name,
  label,
  description,
  checked,
}: {
  name: string;
  label: string;
  description: string;
  checked: boolean;
}) {
  return (
    <label className="flex gap-3 rounded-2xl border border-realtor-primary/12 bg-white/70 p-3 transition hover:border-realtor-primary/35 hover:bg-white">
      <input
        type="checkbox"
        name={name}
        defaultChecked={checked}
        className="mt-1 h-4 w-4 accent-realtor-primary"
      />
      <span>
        <span className="block text-sm font-semibold text-realtor-text">
          {label}
        </span>
        <span className="mt-1 block text-xs leading-5 text-realtor-muted">
          {description}
        </span>
      </span>
    </label>
  );
}

interface LaunchReadiness {
  bookingUrl: string;
  organizationName: string;
  completed: number;
  total: number;
  items: Array<{
    title: string;
    body: string;
    done: boolean;
    href: string;
    external?: boolean;
  }>;
}

async function loadLaunchReadiness(
  organizationId: string,
): Promise<LaunchReadiness> {
  const service = getServiceSupabase();
  const [
    { data: organization },
    { count: activeCatalogCount },
    { data: hours },
    { data: calendarConnection },
    openAiStatus,
  ] = await Promise.all([
    service
      .from("organizations")
      .select(
        "name, slug, primary_color, logo_url, email_from_name, reply_to_email, admin_notification_email",
      )
      .eq("id", organizationId)
      .maybeSingle<{
        name: string;
        slug: string;
        primary_color: string | null;
        logo_url: string | null;
        email_from_name: string | null;
        reply_to_email: string | null;
        admin_notification_email: string | null;
      }>(),
    service
      .from("catalog_items")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("active", true),
    service
      .from("business_hours")
      .select("day_of_week")
      .eq("organization_id", organizationId)
      .eq("enabled", true),
    service
      .from("google_calendar_connection")
      .select("id")
      .eq("organization_id", organizationId)
      .maybeSingle<{ id: number }>(),
    getCredentialSource(
      "openai",
      "api_key",
      "OPENAI_API_KEY",
      organizationId,
    ),
  ]);

  const bookingPath = `/book?org=${organization?.slug ?? ""}`;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const bookingUrl = appUrl ? `${appUrl}${bookingPath}` : bookingPath;
  const emailReady = Boolean(
    organization?.email_from_name ||
      organization?.reply_to_email ||
      organization?.admin_notification_email ||
      process.env.EMAIL_FROM,
  );
  const items = [
    {
      title: "Business profile",
      body: "Name, booking handle, brand colors, and logo.",
      done: Boolean(organization?.name && organization?.slug && organization?.primary_color),
      href: "/admin/settings/business",
    },
    {
      title: "Public booking link",
      body: "The link realtors will use to book.",
      done: Boolean(organization?.slug),
      href: bookingUrl,
      external: true,
    },
    {
      title: "Pricing",
      body: "At least one active package or service.",
      done: (activeCatalogCount ?? 0) > 0,
      href: "/admin/settings/pricing",
    },
    {
      title: "Availability",
      body: "Working days are enabled for public booking.",
      done: (hours ?? []).length > 0,
      href: "/admin/settings/availability",
    },
    {
      title: "Calendar sync",
      body: "Bookings can land on the photographer's calendar.",
      done: Boolean(calendarConnection),
      href: "/admin/settings/integrations",
    },
    {
      title: "Email identity",
      body: "Delivery and booking emails have a sender/reply path.",
      done: emailReady,
      href: "/admin/settings/business",
    },
    {
      title: "AI assistant",
      body: "Optional, but important for the beta wow-factor.",
      done: openAiStatus.source !== "none",
      href: "/admin/settings/integrations",
    },
  ];

  return {
    bookingUrl,
    organizationName: organization?.name ?? "This company",
    completed: items.filter((item) => item.done).length,
    total: items.length,
    items,
  };
}

function LaunchReadinessCard({ readiness }: { readiness: LaunchReadiness }) {
  const ready = readiness.completed === readiness.total;
  return (
    <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-lg shadow-realtor-text/10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-realtor-primary/80">
            Beta readiness
          </p>
          <h2 className="mt-2 text-xl font-semibold text-realtor-text">
            {readiness.completed}/{readiness.total} ready for{" "}
            {readiness.organizationName}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-realtor-muted">
            Use this before sharing the booking link with realtors. The app can
            still run with missing optional items, but this shows what deserves
            attention before beta users start testing.
          </p>
        </div>
        <span
          className={
            "rounded-full border px-3 py-1 text-xs font-semibold " +
            (ready
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-700")
          }
        >
          {ready ? "Ready to share" : "Setup needed"}
        </span>
      </div>

      <div className="mt-5 rounded-2xl border border-realtor-primary/10 bg-realtor-surface-muted/60 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
              Booking link
            </p>
            <code className="mt-2 block overflow-x-auto rounded-xl border border-realtor-primary/15 bg-white px-3 py-2 text-sm text-realtor-text">
              {readiness.bookingUrl}
            </code>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyBookingLinkButton value={readiness.bookingUrl} />
            <a
              href={readiness.bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-realtor-primary/20 bg-white px-4 py-2 text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
            >
              Preview booking
            </a>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {readiness.items.map((item) => (
          <a
            key={item.title}
            href={item.href}
            target={item.external ? "_blank" : undefined}
            rel={item.external ? "noopener noreferrer" : undefined}
            className="rounded-2xl border border-realtor-primary/12 bg-white/65 p-3 transition hover:border-realtor-primary/35 hover:bg-white"
          >
            <span className="flex items-start gap-2">
              <span
                className={
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold " +
                  (item.done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700")
                }
              >
                {item.done ? "✓" : "!"}
              </span>
              <span>
                <span className="block text-sm font-semibold text-realtor-text">
                  {item.title}
                </span>
                <span className="mt-1 block text-xs leading-5 text-realtor-muted">
                  {item.body}
                </span>
              </span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
