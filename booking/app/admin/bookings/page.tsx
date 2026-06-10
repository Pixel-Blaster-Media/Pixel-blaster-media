import Link from "next/link";

import { BUSINESS_TZ } from "@/lib/booking/availability";
import { BOOKING_STATUSES, isCancellable } from "@/lib/booking/booking-status";
import { labelForService } from "@/lib/booking/services";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getServerSupabase } from "@/lib/supabase/server";
import type { BookingStatus } from "@/lib/supabase/database.types";

import CancelBookingButton from "./CancelBookingButton";

export const metadata = { title: "Bookings" };
export const dynamic = "force-dynamic";

interface BookingRow {
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

const ACTIVE_STATUSES: BookingStatus[] = [
  "requested",
  "confirmed",
  "shot",
  "editing",
];

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const params = await searchParams;
  const filter = (FILTERS.find((f) => f.id === params.filter)?.id ??
    "active") as (typeof FILTERS)[number]["id"];
  const search = (params.q ?? "").trim();

  const admin = await requireAdmin();
  const supabase = await getServerSupabase();
  let query = supabase
    .from("bookings")
    .select(
      "id, status, scheduled_at, services, created_at, properties(street_address, city), profiles(full_name, email)",
    )
    .eq("organization_id", admin.organizationId)
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(search ? 500 : 200);

  if (filter === "active") {
    query = query.in("status", ACTIVE_STATUSES);
  } else if (filter !== "all") {
    query = query.eq("status", filter as BookingStatus);
  }

  const { data, error } = await query.returns<BookingRow[]>();
  const bookings = visibleBookingsForFilter(
    filterBookings(data ?? [], search),
    filter,
  );

  if (error) {
    return (
      <p className="text-sm text-red-300">
        Could not load bookings: {error.message}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-white/10 bg-ink-soft/55 p-4 shadow-lg shadow-black/10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
              Job board
            </p>
            <h1 className="mt-1 text-2xl font-bold text-white">Bookings</h1>
            <p className="mt-1 max-w-xl text-sm text-ink-muted">
              {filter === "active"
                ? "Today and upcoming active shoots. Past jobs live in the status filters."
                : "Search and review shoots by status, realtor, property, or service."}
            </p>
          </div>
          <Link
            href="/admin/calendar"
            className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:border-brand-light"
          >
            Open calendar
          </Link>
        </div>
      </header>

      <section className="rounded-2xl border border-white/10 bg-ink-soft/45 p-3 shadow-lg shadow-black/10">
        <form className="flex flex-col gap-2 sm:flex-row" action="/admin/bookings">
          <input type="hidden" name="filter" value={filter} />
          <label className="sr-only" htmlFor="booking-search">
            Search bookings
          </label>
          <input
            id="booking-search"
            name="q"
            defaultValue={search}
            placeholder="Search by address, realtor, city, email, or service..."
            className="min-h-11 flex-1 rounded-full border border-white/10 bg-black/15 px-4 text-sm text-white outline-none transition placeholder:text-ink-muted focus:border-brand-light"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="min-h-11 rounded-full bg-brand px-5 text-sm font-semibold text-white transition hover:bg-brand-light"
            >
              Search
            </button>
            {search ? (
              <Link
                href={`/admin/bookings?filter=${filter}`}
                className="inline-flex min-h-11 items-center rounded-full border border-white/10 px-4 text-sm font-semibold text-ink-muted transition hover:border-white/30 hover:text-white"
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
                  ? "border-brand-light bg-brand/15 text-brand-light"
                  : "border-white/10 text-ink-muted hover:border-white/30 hover:text-white")
              }
            >
              {f.label}
            </Link>
          ))}
        </nav>
      </section>

      {bookings && bookings.length > 0 ? (
        <section className="space-y-3">
          {filter === "active" ? (
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
                  Coming up
                </p>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  Today and future shoots
                </h2>
              </div>
              <p className="text-xs text-ink-muted">
                {bookings.length} active booking{bookings.length === 1 ? "" : "s"}
              </p>
            </div>
          ) : null}
          <ul className="grid gap-3">
            {bookings.map((booking) => (
              <BookingListItem key={booking.id} booking={booking} />
            ))}
          </ul>
        </section>
      ) : (
        <p className="rounded-2xl border border-dashed border-white/10 bg-ink-soft/40 px-4 py-8 text-center text-sm text-ink-muted">
          {search
            ? `No bookings matched "${search}".`
            : filter === "active"
              ? "No active shoots today or coming up."
              : "No bookings in this view."}
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
    <li className="rounded-2xl border border-white/10 bg-ink-soft/45 p-4 transition hover:border-brand-light/40 hover:bg-white/[0.035]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Link href={`/admin/bookings/${booking.id}`} className="min-w-0 flex-1">
          <p className="font-semibold text-white">
            {property?.street_address ?? "-"}
            {property?.city ? (
              <span className="text-ink-muted"> · {property.city}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {profile?.full_name ?? profile?.email ?? "Unknown realtor"}
          </p>
          <p className="mt-2 line-clamp-2 text-xs text-ink-muted">
            {booking.services.map(labelForService).join(", ") || "-"}
          </p>
        </Link>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${meta.pill}`}
          >
            {meta.label}
          </span>
          <span className="text-[10px] text-ink-muted">
            {booking.scheduled_at
              ? new Date(booking.scheduled_at).toLocaleString()
              : "no date"}
          </span>
          <div className="flex flex-wrap justify-end gap-2">
            <Link
              href={`/admin/bookings/${booking.id}`}
              className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:border-brand-light"
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

function filterBookings(bookings: BookingRow[], search: string): BookingRow[] {
  if (!search) return bookings;
  const needle = search.toLowerCase();
  return bookings.filter((booking) => {
    const haystack = [
      booking.properties?.street_address,
      booking.properties?.city,
      booking.profiles?.full_name,
      booking.profiles?.email,
      booking.status,
      ...booking.services.map(labelForService),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

function visibleBookingsForFilter(
  bookings: BookingRow[],
  filter: (typeof FILTERS)[number]["id"],
): BookingRow[] {
  if (filter !== "active") return bookings;
  const todayKey = localDateKey(new Date());
  return bookings.filter(
    (booking) =>
      booking.scheduled_at &&
      localDateKey(new Date(booking.scheduled_at)) >= todayKey,
  );
}

function localDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
