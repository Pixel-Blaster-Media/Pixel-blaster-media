import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/require-admin";
import { getServiceSupabase } from "@/lib/supabase/server";

import BusinessSettingsForm from "./BusinessSettingsForm";
import CopyBookingLinkButton from "./CopyBookingLinkButton";

export const metadata = { title: "Business Settings" };
export const dynamic = "force-dynamic";

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  primary_color: string | null;
  accent_color: string | null;
  logo_url: string | null;
  booking_hero_image_url: string | null;
  booking_hero_secondary_image_url: string | null;
  email_from_name: string | null;
  reply_to_email: string | null;
  admin_notification_email: string | null;
  invoice_timing: string;
}

interface SetupStatus {
  businessProfile: boolean;
  bookingLink: boolean;
  pricing: boolean;
  availability: boolean;
  calendar: boolean;
  emailIdentity: boolean;
  testBookingLink: boolean;
}

export default async function BusinessSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const params = await searchParams;
  const isWelcome = params.welcome === "1";
  const admin = await requireAdmin();
  const service = getServiceSupabase();
  const [
    { data: organization, error },
    { count: activeCatalogCount },
    { data: hours },
    { data: calendarConnection },
  ] = await Promise.all([
    service
      .from("organizations")
      .select(
        "id, name, slug, primary_color, accent_color, logo_url, booking_hero_image_url, booking_hero_secondary_image_url, email_from_name, reply_to_email, admin_notification_email, invoice_timing",
      )
      .eq("id", admin.organizationId)
      .maybeSingle<OrganizationRow>(),
    service
      .from("catalog_items")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", admin.organizationId)
      .eq("active", true),
    service
      .from("business_hours")
      .select("day_of_week, enabled")
      .eq("organization_id", admin.organizationId)
      .eq("enabled", true),
    service
      .from("google_calendar_connection")
      .select("id, google_account_email")
      .eq("organization_id", admin.organizationId)
      .maybeSingle<{ id: number; google_account_email: string }>(),
  ]);

  if (error || !organization) notFound();

  const bookingPath = `/book?org=${organization.slug}`;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const bookingUrl = appUrl ? `${appUrl}${bookingPath}` : bookingPath;
  const setupStatus: SetupStatus = {
    businessProfile: Boolean(organization.name && organization.primary_color),
    bookingLink: Boolean(organization.slug),
    pricing: (activeCatalogCount ?? 0) > 0,
    availability: (hours ?? []).length > 0,
    calendar: Boolean(calendarConnection),
    emailIdentity: Boolean(
      organization.email_from_name ||
        organization.reply_to_email ||
        organization.admin_notification_email,
    ),
    testBookingLink: Boolean(organization.slug && organization.name),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/admin/settings"
          className="rounded-full border border-realtor-primary/15 bg-realtor-surface px-3 py-1.5 text-xs font-semibold text-realtor-muted transition hover:border-realtor-primary/35 hover:text-realtor-primary"
        >
          Back to settings
        </Link>
      </div>

      <header className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-lg shadow-realtor-text/10">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-realtor-primary/80">
          {isWelcome ? "Welcome" : "Settings"}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-realtor-text md:text-3xl">
          {isWelcome ? "Set up your booking system" : "Business profile"}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-realtor-muted">
          {isWelcome
            ? "You are in. Finish these basics and your booking link will be ready to send to realtors."
            : "The company-level identity for this booking system. This is the foundation for letting other photography companies run their own version later."}
        </p>
      </header>

      <SetupChecklist
        status={setupStatus}
        bookingUrl={bookingUrl}
        calendarEmail={calendarConnection?.google_account_email ?? null}
      />

      <BusinessSettingsForm organization={organization} />
    </div>
  );
}

function SetupChecklist({
  status,
  bookingUrl,
  calendarEmail,
}: {
  status: SetupStatus;
  bookingUrl: string;
  calendarEmail: string | null;
}) {
  const completed = Object.values(status).filter(Boolean).length;
  const total = Object.keys(status).length;

  return (
    <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-lg shadow-realtor-text/10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary/80">
            Launch checklist
          </p>
          <h2 className="mt-2 text-xl font-semibold text-realtor-text">
            {completed}/{total} setup steps complete
          </h2>
          <p className="mt-1 text-sm leading-6 text-realtor-muted">
            Keep this short: brand it, set email identity, confirm pricing,
            set hours, connect the calendar, then preview the booking link.
          </p>
        </div>
        <span className="rounded-full border border-realtor-primary/20 bg-realtor-primary/10 px-3 py-1 text-xs font-semibold text-realtor-primary">
          {completed === total ? "Ready to launch" : "Needs setup"}
        </span>
      </div>

      <div className="mt-5 rounded-2xl border border-realtor-primary/10 bg-realtor-surface-muted/60 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
          Public booking link
        </p>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-realtor-primary/15 bg-white px-3 py-2 text-sm text-realtor-text">
            {bookingUrl}
          </code>
          <div className="flex flex-wrap gap-2">
            <CopyBookingLinkButton value={bookingUrl} />
            <Link
              href={bookingUrl}
              target="_blank"
              className="rounded-full border border-realtor-primary/20 bg-white px-4 py-2 text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
            >
              Preview page
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <ChecklistItem
          done={status.businessProfile}
          title="Business profile"
          body="Name, brand colors, and logo live here."
          href="/admin/settings/business"
        />
        <ChecklistItem
          done={status.bookingLink}
          title="Booking link"
          body="This is the public link realtors can use."
          href={bookingUrl}
          external
        />
        <ChecklistItem
          done={status.emailIdentity}
          title="Email identity"
          body="Set sender name, reply-to, and admin alerts."
          href="/admin/settings/business"
        />
        <ChecklistItem
          done={status.pricing}
          title="Pricing and packages"
          body="Review bundles, add-ons, durations, and square footage pricing."
          href="/admin/settings/pricing"
        />
        <ChecklistItem
          done={status.availability}
          title="Availability"
          body="Working days and hours decide which booking slots appear."
          href="/admin/settings/availability"
        />
        <ChecklistItem
          done={status.calendar}
          title="Google Calendar"
          body={
            calendarEmail
              ? `Connected to ${calendarEmail}.`
              : "Connect this so bookings write to the photographer's calendar. Opens in a new tab so this setup page stays put."
          }
          href="/admin/settings/integrations"
          external
        />
        <ChecklistItem
          done={status.testBookingLink}
          title="Preview booking"
          body="Open the public booking page and make sure it feels right."
          href={bookingUrl}
          external
        />
      </div>
    </section>
  );
}

function ChecklistItem({
  done,
  title,
  body,
  href,
  external = false,
}: {
  done: boolean;
  title: string;
  body: string;
  href: string;
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="group rounded-2xl border border-realtor-primary/15 bg-white/65 p-4 transition hover:border-realtor-primary/35 hover:bg-white"
    >
      <div className="flex items-start gap-3">
        <span
          className={
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold " +
            (done
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-700")
          }
        >
          {done ? "✓" : "!"}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-realtor-text">
            {title}
          </span>
          <span className="mt-1 block text-xs leading-5 text-realtor-muted">
            {body}
          </span>
          <span className="mt-2 block text-xs font-semibold text-realtor-primary group-hover:underline">
            {done ? "Review" : "Set up"}
          </span>
        </span>
      </div>
    </Link>
  );
}
