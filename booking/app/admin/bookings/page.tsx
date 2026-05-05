import Link from "next/link";

import { BOOKING_STATUSES } from "@/lib/booking/booking-status";
import { labelForService } from "@/lib/booking/services";
import { getServerSupabase } from "@/lib/supabase/server";
import type { BookingStatus } from "@/lib/supabase/database.types";

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
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const filter = (FILTERS.find((f) => f.id === params.filter)?.id ??
    "active") as (typeof FILTERS)[number]["id"];

  const supabase = getServerSupabase();
  let query = supabase
    .from("bookings")
    .select(
      "id, status, scheduled_at, services, created_at, properties(street_address, city), profiles(full_name, email)",
    )
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (filter === "active") {
    query = query.in("status", ACTIVE_STATUSES);
  } else if (filter !== "all") {
    query = query.eq("status", filter as BookingStatus);
  }

  const { data: bookings, error } = await query.returns<BookingRow[]>();

  if (error) {
    return (
      <p className="text-sm text-red-300">
        Could not load bookings: {error.message}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
            Job board
          </p>
          <h1 className="mt-1 text-2xl font-bold text-white">Bookings</h1>
        </div>
        <nav className="flex flex-wrap gap-1 text-xs">
          {FILTERS.map((f) => (
            <Link
              key={f.id}
              href={`/admin/bookings?filter=${f.id}`}
              className={
                "rounded-md border px-3 py-1.5 transition " +
                (f.id === filter
                  ? "border-brand-light bg-brand/15 text-brand-light"
                  : "border-white/10 text-ink-muted hover:border-white/30 hover:text-white")
              }
            >
              {f.label}
            </Link>
          ))}
        </nav>
      </header>

      {bookings && bookings.length > 0 ? (
        <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10 bg-ink-soft/50">
          {bookings.map((b) => {
            const property = b.properties;
            const profile = b.profiles;
            const meta = BOOKING_STATUSES[b.status];
            return (
              <li key={b.id}>
                <Link
                  href={`/admin/bookings/${b.id}`}
                  className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 transition hover:bg-white/[0.03]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white">
                      {property?.street_address ?? "—"}
                      {property?.city ? (
                        <span className="text-ink-muted"> · {property.city}</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {profile?.full_name ?? profile?.email ?? "Unknown realtor"}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {b.services.map(labelForService).join(", ") || "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${meta.pill}`}
                    >
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-ink-muted">
                      {b.scheduled_at
                        ? new Date(b.scheduled_at).toLocaleString()
                        : "no date"}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-white/10 bg-ink-soft/40 px-4 py-8 text-center text-sm text-ink-muted">
          No bookings in this view.
        </p>
      )}
    </div>
  );
}
