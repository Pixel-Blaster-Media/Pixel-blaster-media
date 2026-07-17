import SettingsHub from "./SettingsHub";
import { requireAdmin } from "@/lib/auth/require-admin";
import { hasPlatformAdminAccess } from "@/lib/auth/require-platform-admin";
import { getCredentialSource } from "@/lib/integrations/credentials";
import { getServiceSupabase } from "@/lib/supabase/server";
import CopyBookingLinkButton from "./business/CopyBookingLinkButton";

const SETTINGS_GROUPS = [
  {
    title: "Business setup",
    description: "The essentials customers see and use when they book.",
    sections: [
      {
        href: "/admin/settings/business",
        title: "Business profile",
        description: "Company identity, booking link, brand, and email sender details.",
      },
      {
        href: "/admin/settings/availability",
        title: "Availability",
        description: "Working hours, booking windows, and time away.",
      },
      {
        href: "/admin/settings/pricing",
        title: "Pricing & services",
        description: "Packages, add-ons, durations, and square-footage rules.",
      },
    ],
  },
  {
    title: "Tools & workflow",
    description: "How the admin workspace behaves and connects to outside services.",
    sections: [
      {
        href: "/admin/settings/integrations",
        title: "Integrations",
        description: "Calendar, accounting, delivery, email, maps, and AI connections.",
      },
      {
        href: "/admin/settings/preferences",
        title: "Workspace & app",
        description: "Install the app, manage phone notifications, and set the company Today view.",
      },
    ],
  },
] as const;

const PLATFORM_GROUP = {
  title: "Platform administration",
  description: "Pixel Blaster platform controls, separate from this company’s settings.",
  sections: [
    {
      href: "/admin/settings/companies",
      title: "Companies",
      description: "Create and manage isolated company workspaces and owner invitations.",
    },
  ],
} as const;

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const admin = await requireAdmin();
  const readiness = await loadLaunchReadiness(admin.organizationId);
  const groups = (await hasPlatformAdminAccess(admin))
    ? [...SETTINGS_GROUPS, PLATFORM_GROUP]
    : SETTINGS_GROUPS;

  return (
    <div className="space-y-7 pb-10">
      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-realtor-primary/75">
          Administration
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-realtor-text">
          Settings
        </h1>
        <p className="mt-2 text-sm leading-6 text-realtor-muted">
          Set up the customer experience first, then connect the tools your team
          uses behind the scenes.
        </p>
      </header>

      <LaunchReadinessCard readiness={readiness} />
      <SettingsHub groups={groups} />
    </div>
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
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
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
      done: Boolean(calendarConnection && googleConfigured),
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
  const remainingItems = readiness.items.filter((item) => !item.done);
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

      {remainingItems.length ? (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
            Needs attention
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {remainingItems.map((item) => (
              <a
                key={item.title}
                href={item.href}
                target={item.external ? "_blank" : undefined}
                rel={item.external ? "noopener noreferrer" : undefined}
                className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 transition hover:border-amber-300 hover:bg-amber-50"
              >
                <span className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-white text-[10px] font-bold text-amber-700">
                    !
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
        </div>
      ) : null}
    </section>
  );
}
