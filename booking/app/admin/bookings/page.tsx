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


export const metadata = { title: "Jobs Board" };
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
        title="Jobs Board"
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

      <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/60 p-2.5 shadow-sm">
        <form className="flex min-w-0 gap-2" action="/admin/bookings">
          <input type="hidden" name="filter" value={filter} />
          <label className="sr-only" htmlFor="booking-search">
            Search jobs
          </label>
          <input
            id="booking-search"
            name="q"
            defaultValue={search}
            placeholder="Search jobs..."
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
        <nav className="mt-3 flex gap-1 overflow-x-auto pb-1 text-xs">
          {FILTERS.map((f) => (
            <Link
              key={f.id}
              href={bookingHref(f.id, search)}
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
        <section>
          <ul className="grid gap-3">
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
    <li className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/60 p-4 transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Link href={`/admin/bookings/${booking.id}`} className="min-w-0 flex-1">
          <p className="font-semibold text-realtor-text">
            {property?.street_address ?? "-"}
            {property?.city ? (
              <span className="text-realtor-muted"> · {property.city}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-realtor-muted">
            {profile?.full_name ?? profile?.email ?? "Unknown realtor"}
          </p>
          <p className="mt-2 line-clamp-2 text-xs text-realtor-muted">
            {booking.services.map(labelForService).join(", ") || "-"}
          </p>
        </Link>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${meta.pill}`}
          >
            {meta.label}
          </span>
          <span className="text-[10px] text-realtor-muted">
            {booking.scheduled_at
              ? formatBookingDate(booking.scheduled_at)
              : "Needs scheduling"}
          </span>
          <div className="flex flex-wrap justify-end gap-2">
            <Link
              href={`/admin/bookings/${booking.id}`}
              className="rounded-full border border-realtor-primary/20 bg-white px-2.5 py-1 text-[11px] font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
            >
              Open
            </Link>
            {isCancellable(booking.status) ? (
              <CancelBookingButton bookingId={booking.id} label="Cancel" compact />
            ) : null}
          </div>
        </div>
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
