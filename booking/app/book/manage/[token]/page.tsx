import { BUSINESS_TZ } from "@/lib/booking/availability";
import { isCancellable } from "@/lib/booking/booking-status";
import { verifyManageToken } from "@/lib/booking/manage-token";
import { loadSlotsForNextDays } from "@/lib/booking/slot-display";
import { getOrganizationEmailSettings } from "@/lib/email/settings";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { BookingStatus } from "@/lib/supabase/database.types";

import ManageBookingClient from "./ManageBookingClient";

export const dynamic = "force-dynamic";

/**
 * Public self-serve manage-booking page. Reached only via the signed
 * link in the confirmation email — there is no session; the HMAC token
 * in the URL is the authorization.
 */

const CONTACT_EMAIL = "info@pixelblastermedia.com";
const DEFAULT_DURATION_MINUTES = 60;
const SLOT_WINDOW_DAYS = 28;

interface ManagePageBookingRow {
  id: string;
  organization_id: string;
  status: BookingStatus;
  scheduled_at: string | null;
  scheduled_ends_at: string | null;
  unit_number: string | null;
  square_footage: number | null;
  properties: {
    street_address: string;
    city: string | null;
    postal_code: string | null;
  } | null;
  profiles: {
    email: string;
    full_name: string | null;
  } | null;
}

export default async function ManageBookingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: rawToken } = await params;
  const token = decodeURIComponent(rawToken);
  const bookingId = verifyManageToken(token);
  if (!bookingId) return <InvalidLinkPanel />;

  const service = getServiceSupabase();
  const { data: booking, error } = await service
    .from("bookings")
    .select(
      "id, organization_id, status, scheduled_at, scheduled_ends_at, unit_number, square_footage, properties(street_address, city, postal_code), profiles(email, full_name)",
    )
    .eq("id", bookingId)
    .maybeSingle<ManagePageBookingRow>();

  if (error || !booking) return <InvalidLinkPanel />;

  const emailSettings = await getOrganizationEmailSettings(
    booking.organization_id,
  );
  const organizationName = emailSettings.organizationName;
  const contactEmail = emailSettings.replyToEmail ?? CONTACT_EMAIL;

  const streetLine = booking.properties
    ? booking.unit_number
      ? `${booking.properties.street_address}, Unit ${booking.unit_number}`
      : booking.properties.street_address
    : "";
  const addressLine = booking.properties
    ? [streetLine, booking.properties.city, booking.properties.postal_code]
        .filter(Boolean)
        .join(", ")
    : "(unknown address)";

  const scheduledAt = booking.scheduled_at
    ? new Date(booking.scheduled_at)
    : null;
  const whenLabel = scheduledAt
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: BUSINESS_TZ,
        dateStyle: "full",
        timeStyle: "short",
      }).format(scheduledAt)
    : "(no time set)";

  const isPast =
    scheduledAt !== null && scheduledAt.getTime() <= Date.now();
  const manageable =
    isCancellable(booking.status) && scheduledAt !== null && !isPast;

  if (!manageable) {
    return (
      <main className="realtor-theme realtor-elevated-panel rounded-3xl p-5 md:p-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-realtor-primary">
          Manage booking
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-realtor-text md:text-3xl">
          {booking.status === "cancelled"
            ? "This booking was cancelled."
            : "Changes aren't available for this booking."}
        </h1>
        <BookingSummary
          addressLine={addressLine}
          whenLabel={whenLabel}
          squareFootage={booking.square_footage}
        />
        <p className="mt-5 max-w-2xl text-sm leading-6 text-realtor-muted">
          {booking.status === "cancelled"
            ? "If you'd like to book a new shoot, you can do that anytime from the booking page."
            : isPast
              ? "The scheduled time has already passed, so it can't be changed online."
              : "This shoot is already in production, so it can't be changed online."}{" "}
          Questions? Email{" "}
          <a
            className="font-medium text-realtor-primary underline"
            href={`mailto:${contactEmail}`}
          >
            {contactEmail}
          </a>{" "}
          and we&apos;ll sort it out.
        </p>
        <p className="mt-6 text-xs text-realtor-muted">— {organizationName}</p>
      </main>
    );
  }

  // Same shoot length when rescheduling: keep end - start, floor 60 min.
  const durationMinutes = booking.scheduled_ends_at
    ? Math.max(
        Math.round(
          (new Date(booking.scheduled_ends_at).getTime() -
            scheduledAt.getTime()) /
            60_000,
        ),
        DEFAULT_DURATION_MINUTES,
      )
    : DEFAULT_DURATION_MINUTES;

  const daysOfSlots = await loadSlotsForNextDays(
    durationMinutes,
    SLOT_WINDOW_DAYS,
    { organizationId: booking.organization_id },
  );

  return (
    <main className="realtor-theme space-y-6">
      <header className="realtor-elevated-panel rounded-3xl p-5 md:p-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-realtor-primary">
          Manage booking
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-realtor-text md:text-3xl">
          Reschedule or cancel your shoot.
        </h1>
        <BookingSummary
          addressLine={addressLine}
          whenLabel={whenLabel}
          squareFootage={booking.square_footage}
        />
        <p className="mt-4 max-w-2xl text-sm leading-6 text-realtor-muted">
          Pick a new time below, or cancel if your plans changed. Need
          something else? Email{" "}
          <a
            className="font-medium text-realtor-primary underline"
            href={`mailto:${contactEmail}`}
          >
            {contactEmail}
          </a>
          .
        </p>
      </header>

      <ManageBookingClient
        token={token}
        daysOfSlots={daysOfSlots}
        currentWhenLabel={whenLabel}
        addressLine={addressLine}
      />
    </main>
  );
}

function BookingSummary({
  addressLine,
  whenLabel,
  squareFootage,
}: {
  addressLine: string;
  whenLabel: string;
  squareFootage: number | null;
}) {
  return (
    <dl className="mt-6 grid gap-3 rounded-2xl border border-realtor-primary/15 bg-realtor-surface-muted/60 p-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs uppercase tracking-wider text-realtor-muted">
          Address
        </dt>
        <dd className="mt-1 font-medium text-realtor-text">{addressLine}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wider text-realtor-muted">
          Current time
        </dt>
        <dd className="mt-1 font-medium text-realtor-text">{whenLabel}</dd>
      </div>
      {squareFootage ? (
        <div>
          <dt className="text-xs uppercase tracking-wider text-realtor-muted">
            Size
          </dt>
          <dd className="mt-1 font-medium text-realtor-text">
            ~{squareFootage.toLocaleString("en-US")} sqft
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function InvalidLinkPanel() {
  return (
    <main className="realtor-theme realtor-elevated-panel rounded-3xl p-5 md:p-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-realtor-primary">
        Manage booking
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-realtor-text md:text-3xl">
        This link looks expired or invalid.
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-realtor-muted">
        Double-check that you opened the full link from your confirmation
        email. If it still doesn&apos;t work, email{" "}
        <a
          className="font-medium text-realtor-primary underline"
          href={`mailto:${CONTACT_EMAIL}`}
        >
          {CONTACT_EMAIL}
        </a>{" "}
        and we&apos;ll reschedule or cancel for you.
      </p>
    </main>
  );
}
