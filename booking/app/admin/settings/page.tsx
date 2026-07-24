import SettingsHub from "./SettingsHub";
import { requireAdmin } from "@/lib/auth/require-admin";
import { hasPlatformAdminAccess } from "@/lib/auth/require-platform-admin";
import { getServiceSupabase } from "@/lib/supabase/server";
import CopyBookingLinkButton from "./business/CopyBookingLinkButton";
import AdminPageHeading from "../AdminPageHeading";

const SETTINGS_GROUPS = [
  {
    title: "Bookings",
    description: "The three things that control what clients see and when they can book.",
    sections: [
      {
        href: "/admin/settings/business",
        title: "Business profile",
        description: "Company name, booking link, brand, and email identity.",
      },
      {
        href: "/admin/settings/pricing",
        title: "Services & pricing",
        description: "Packages, add-ons, durations, and pricing rules.",
      },
      {
        href: "/admin/settings/availability",
        title: "Availability",
        description: "Working hours, booking windows, and time away.",
      },
    ],
  },
  {
    title: "Connections",
    description: "Keep the tools behind your workflow connected and working.",
    sections: [
      {
        href: "/admin/settings/integrations",
        title: "Manage connections",
        description: "Calendar, email, accounting, delivery, maps, and optional AI tools.",
      },
    ],
  },
  {
    title: "App & daily view",
    description: "A small set of controls for how the admin workspace behaves.",
    sections: [
      {
        href: "/admin/settings/preferences",
        title: "App & Today preferences",
        description: "Install the app, manage notifications, and simplify the Today screen.",
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
      description: "Create isolated company workspaces and invite their owners.",
    },
  ],
} as const;

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const admin = await requireAdmin();
  const readiness = await loadEssentialSetup(admin.organizationId);
  const groups = (await hasPlatformAdminAccess(admin))
    ? [...SETTINGS_GROUPS, PLATFORM_GROUP]
    : SETTINGS_GROUPS;

  return (
    <div className="space-y-4 pb-10">
      <AdminPageHeading eyebrow="Company controls" title="Settings" />

      <EssentialSetupCard readiness={readiness} />
      <SettingsHub groups={groups} />
    </div>
  );
}

interface EssentialSetup {
  bookingUrl: string;
  organizationName: string;
  items: Array<{
    title: string;
    body: string;
    done: boolean;
    href: string;
    external?: boolean;
  }>;
}

async function loadEssentialSetup(
  organizationId: string,
): Promise<EssentialSetup> {
  const service = getServiceSupabase();
  const [
    { data: organization },
    { count: activeCatalogCount },
    { data: hours },
    { data: calendarConnection },
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

  return {
    bookingUrl,
    organizationName: organization?.name ?? "This company",
    items: [
      {
        title: "Finish the business profile",
        body: "Add the company name, booking handle, and primary brand color.",
        done: Boolean(
          organization?.name && organization?.slug && organization?.primary_color,
        ),
        href: "/admin/settings/business",
      },
      {
        title: "Add a service or package",
        body: "Clients need at least one active option before they can book.",
        done: (activeCatalogCount ?? 0) > 0,
        href: "/admin/settings/pricing",
      },
      {
        title: "Set working hours",
        body: "Enable at least one day for public booking.",
        done: (hours ?? []).length > 0,
        href: "/admin/settings/availability",
      },
      {
        title: "Connect the booking calendar",
        body: "Use Google Calendar to block busy time and receive new shoots.",
        done: Boolean(calendarConnection && googleConfigured),
        href: "/admin/settings/integrations#google-calendar",
      },
      {
        title: "Set the email identity",
        body: "Choose the sender name, reply-to address, or admin alert inbox.",
        done: emailReady,
        href: "/admin/settings/business",
      },
    ],
  };
}

function EssentialSetupCard({ readiness }: { readiness: EssentialSetup }) {
  const remainingItems = readiness.items.filter((item) => !item.done);
  const ready = remainingItems.length === 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-realtor-primary/12 bg-realtor-surface/80 shadow-sm">
      <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
        <span
          aria-hidden="true"
          className={
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold " +
            (ready
              ? "bg-realtor-primary/10 text-realtor-primary"
              : "bg-amber-100 text-amber-800")
          }
        >
          {ready ? "✓" : remainingItems.length}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-realtor-text">
                {ready
                  ? "Everything essential is ready"
                  : `${remainingItems.length} setup ${remainingItems.length === 1 ? "item needs" : "items need"} attention`}
              </h2>
              <p className="mt-1 text-sm leading-5 text-realtor-muted">
                {ready
                  ? `${readiness.organizationName} can take bookings. You do not need to manage routine settings.`
                  : "Only the items that need you appear here. Finish these before sharing the booking link."}
              </p>
            </div>
            <span
              className={
                "rounded-full px-2.5 py-1 text-[11px] font-semibold " +
                (ready
                  ? "bg-realtor-primary/10 text-realtor-primary"
                  : "bg-amber-100 text-amber-900")
              }
            >
              {ready ? "Working" : "Action needed"}
            </span>
          </div>

          {remainingItems.length ? (
            <div className="mt-4 divide-y divide-amber-200/70 overflow-hidden rounded-xl border border-amber-200 bg-amber-50/65">
              {remainingItems.map((item) => (
                <a
                  key={item.title}
                  href={item.href}
                  target={item.external ? "_blank" : undefined}
                  rel={item.external ? "noopener noreferrer" : undefined}
                  className="group flex min-h-16 items-center justify-between gap-3 px-3 py-3 transition hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-realtor-text">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-realtor-muted">
                      {item.body}
                    </span>
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-amber-800">
                    →
                  </span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-realtor-primary/10 bg-realtor-soft/45 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-realtor-muted">
            Public booking link
          </p>
          <code className="mt-1 block truncate text-xs text-realtor-text sm:text-sm">
            {readiness.bookingUrl}
          </code>
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyBookingLinkButton value={readiness.bookingUrl} />
          <a
            href={readiness.bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center rounded-full border border-realtor-primary/20 bg-white px-4 text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
          >
            Preview
          </a>
        </div>
      </div>
    </section>
  );
}
