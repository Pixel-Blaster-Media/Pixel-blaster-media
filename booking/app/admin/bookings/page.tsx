import Link from "next/link";
import { parseAdminSearchCursor, type BookingSearchCursor } from "@/lib/booking/admin-search-cursor";

import { BUSINESS_TZ } from "@/lib/booking/availability";
import { BOOKING_STATUSES, isCancellable } from "@/lib/booking/booking-status";
import { labelForService } from "@/lib/booking/services";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getServerSupabase } from "@/lib/supabase/server";
import type { BookingStatus, Database } from "@/lib/supabase/database.types";

import AdminPageHeading from "../AdminPageHeading";
import CancelBookingButton from "./CancelBookingButton";


export const metadata = { title: "Bookings" };
export const dynamic = "force-dynamic";

interface BookingRow {
  _cursor: BookingSearchCursor;
  id: string;
  status: BookingStatus;
  scheduled_at: string | null;
  services: string[];
  created_at: string;
  properties: { street_address: string; city: string | null } | null;
  profiles: { full_name: string | null; email: string } | null;
}

const FILTERS: { id: "active" | "all" | BookingStatus; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "all", label: "All" },
  { id: "confirmed", label: "Confirmed" },
  { id: "shot", label: "Shot" },
  { id: "editing", label: "Editing" },
  { id: "delivered", label: "Delivered" },
  { id: "cancelled", label: "Cancelled" },
];

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; after?: string }>;
}) {
  const params = await searchParams;
  const filter = (FILTERS.find((f) => f.id === params.filter)?.id ??
    "active") as (typeof FILTERS)[number]["id"];
  const search = (params.q ?? "").trim();

  const admin = await requireAdmin();
  const supabase = await getServerSupabase();
  const after = parseAdminSearchCursor(params.after, "booking");
  const args: Database["public"]["Functions"]["admin_booking_search"]["Args"] = {
    p_organization_id: admin.organizationId, p_query: search, p_filter: filter, p_after: after,
  };
  // SSR 0.5 loses RPC inference; args remain checked against Database.
  const { data, error } = await supabase.rpc("admin_booking_search", args as never);
  const rows = (data ?? []) as unknown as BookingRow[];
  const hasMore = rows.length > 50;
  const window = rows.slice(0, 50);
  const bookings = window;
  const nextParams = new URLSearchParams({ filter, q: search, after: JSON.stringify(window.at(-1)?._cursor ?? null) });

  if (error) {
    return (
      <p className="text-sm text-red-700">
        Could not load bookings: {error.message}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <AdminPageHeading
        eyebrow="Work queue"
        title="Bookings"
        meta={
          filter === "active"
            ? `${bookings.length} active job${bookings.length === 1 ? "" : "s"} shown`
            : `${bookings.length} job${bookings.length === 1 ? "" : "s"} shown`
        }
        actions={
          <Link
            href="/admin/calendar"
            className="tap-target inline-flex items-center rounded-full border border-realtor-primary/15 px-3 py-2 text-xs font-semibold text-realtor-text transition hover:border-realtor-primary/40"
          >
            Open calendar
          </Link>
        }
      />

      <section className="studio-booking-search">
        <form className="flex min-w-0 gap-2" action="/admin/bookings">
          <input type="hidden" name="filter" value={filter} />
          <label className="sr-only" htmlFor="booking-search">
            Search bookings
          </label>
          <input
            id="booking-search"
            name="q"
            defaultValue={search}
            placeholder="Search bookings..."
            className="min-h-11 min-w-0 flex-1 rounded-full border border-realtor-primary/15 bg-white/65 px-4 text-sm text-realtor-text outline-none transition placeholder:text-realtor-muted focus:border-realtor-primary/45"
          />
          <div className="flex shrink-0 gap-2">
            <button
              type="submit"
              className="min-h-11 rounded-full bg-realtor-primary px-5 text-sm font-semibold text-white transition hover:bg-realtor-primary/90"
            >
              Search
            </button>
            {search ? (
              <Link
                href={`/admin/bookings?filter=${filter}`}
                className="inline-flex min-h-11 items-center rounded-full border border-realtor-primary/15 px-4 text-sm font-semibold text-realtor-muted transition hover:border-realtor-primary/40 hover:text-realtor-primary"
              >
                Clear
              </Link>
            ) : null}
          </div>
        </form>
        <nav aria-label="Booking status filters" className="mt-3 flex gap-1 overflow-x-auto pb-1 text-xs">
          {FILTERS.map((f) => (
            <Link
              key={f.id}
              href={bookingHref(f.id, search)}
              aria-current={f.id === filter ? "page" : undefined}
              className={
                "tap-target shrink-0 rounded-full border px-3 py-1.5 transition " +
                (f.id === filter
                  ? "border-realtor-primary bg-realtor-primary/15 text-realtor-primary"
                  : "border-realtor-primary/15 text-realtor-muted hover:border-realtor-primary/40 hover:text-realtor-primary")
              }
            >
              {f.label}
            </Link>
          ))}
        </nav>
      </section>

      <nav aria-label="Job result pages" className="flex gap-4 text-sm text-realtor-primary">
        <span>Up to 50 results per page · priority and schedule order</span>
        {after ? <Link href={bookingHref(filter, search)}>First page</Link> : null}
        {hasMore ? <Link href={`/admin/bookings?${nextParams}`}>Next page</Link> : null}
      </nav>
      {bookings && bookings.length > 0 ? (
        <section aria-label="Bookings" className="studio-bookings-list">
          <div className="studio-booking-columns" aria-hidden="true"><span>Property</span><span>Realtor &amp; services</span><span>Scheduled</span><span>Status</span><span>Actions</span></div>
          <ul>
            {bookings.map((booking) => (
              <BookingListItem key={booking.id} booking={booking} />
            ))}
          </ul>
        </section>
      ) : (
        <p className="rounded-2xl border border-dashed border-realtor-primary/15 bg-realtor-surface/60 px-4 py-8 text-center text-sm text-realtor-muted">
          {search
            ? `No jobs matched "${search}".`
            : filter === "active"
              ? "No active jobs need attention."
              : "No jobs in this view."}
        </p>
      )}
    </div>
  );
}

function BookingListItem({ booking }: { booking: BookingRow }) {
  const property = booking.properties;
  const profile = booking.profiles;
  const meta = BOOKING_STATUSES[booking.status];

  return (
    <li className="studio-booking-row">
      <Link href={`/admin/bookings/${booking.id}`}>
        <strong>{property?.street_address ?? "Address not set"}</strong>
        <small>{property?.city ?? "City not set"}</small>
      </Link>
      <div><span>{profile?.full_name ?? profile?.email ?? "Unknown realtor"}</span><small>{booking.services.map(labelForService).join(", ") || "Services not set"}</small></div>
      <div>{booking.scheduled_at ? <time dateTime={booking.scheduled_at}>{formatBookingDate(booking.scheduled_at)}</time> : "Needs scheduling"}</div>
      <div><span className={`inline-block rounded border px-2 py-1 text-[11px] font-semibold ${meta.pill}`}>{meta.label}</span></div>
      <div className="studio-booking-actions">
        <Link href={`/admin/bookings/${booking.id}`} aria-label={`Open booking for ${property?.street_address ?? "unknown address"}`}>Open →</Link>
        {isCancellable(booking.status) ? <CancelBookingButton bookingId={booking.id} label="Cancel" compact /> : null}
      </div>
    </li>
  );
}

function bookingHref(filter: (typeof FILTERS)[number]["id"], search: string) {
  const params = new URLSearchParams({ filter });
  if (search) params.set("q", search);
  return `/admin/bookings?${params.toString()}`;
}



function formatBookingDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
