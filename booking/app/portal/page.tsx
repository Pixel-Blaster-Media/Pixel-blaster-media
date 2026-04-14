import Link from "next/link";
import type { Metadata } from "next";

import { BOOKING_STATUSES } from "@/lib/booking/booking-status";
import { requireUser } from "@/lib/auth/require-user";
import { getServerSupabase } from "@/lib/supabase/server";
import type { BookingStatus } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "My listings" };
export const dynamic = "force-dynamic";

interface PropertyRow {
  id: string;
  street_address: string;
  city: string | null;
  postal_code: string | null;
  bookings: {
    id: string;
    status: BookingStatus;
    scheduled_at: string | null;
    created_at: string;
  }[];
}

interface DeliverableRow {
  property_id: string;
  thumbnail_url: string | null;
  created_at: string;
}

export default async function PortalIndex() {
  const user = await requireUser("/portal");
  const supabase = getServerSupabase();

  // RLS scopes these selects to the current user — realtors only see
  // their own properties / bookings / deliverables.
  const { data: properties } = await supabase
    .from("properties")
    .select(
      "id, street_address, city, postal_code, bookings(id, status, scheduled_at, created_at)",
    )
    .eq("owner_id", user.userId)
    .order("created_at", { ascending: false })
    .returns<PropertyRow[]>();

  // Pull one thumbnail per property from the most-recent deliverable
  // that has one. Separate query to keep the primary select simple.
  const propertyIds = (properties ?? []).map((p) => p.id);
  const thumbnails = new Map<string, string>();
  if (propertyIds.length > 0) {
    const { data: deliverables } = await supabase
      .from("deliverables")
      .select("property_id, thumbnail_url, created_at")
      .in("property_id", propertyIds)
      .not("thumbnail_url", "is", null)
      .order("created_at", { ascending: false })
      .returns<DeliverableRow[]>();

    for (const d of deliverables ?? []) {
      if (d.thumbnail_url && !thumbnails.has(d.property_id)) {
        thumbnails.set(d.property_id, d.thumbnail_url);
      }
    }
  }

  if (!properties || properties.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">My listings</h1>
        <Link
          href="/portal/book"
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light"
        >
          Book another shoot →
        </Link>
      </div>

      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {properties.map((p) => {
          const latestBooking = pickLatestBooking(p.bookings);
          const meta = latestBooking
            ? BOOKING_STATUSES[latestBooking.status]
            : null;
          const thumb = thumbnails.get(p.id);

          return (
            <li key={p.id}>
              <Link
                href={`/portal/${p.id}`}
                className="group block overflow-hidden rounded-xl border border-white/10 bg-ink-soft/50 transition hover:border-brand/40 hover:bg-ink-soft"
              >
                <div className="aspect-[4/3] w-full overflow-hidden bg-black/40">
                  {thumb ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={thumb}
                      alt=""
                      className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-ink-muted">
                      No preview yet
                    </div>
                  )}
                </div>
                <div className="space-y-1 p-4">
                  <p className="font-semibold text-white">
                    {p.street_address}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {[p.city, p.postal_code].filter(Boolean).join(" ")}
                  </p>
                  {meta ? (
                    <span
                      className={`mt-2 inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${meta.pill}`}
                    >
                      {meta.label}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-dashed border-white/10 bg-ink-soft/40 p-8 text-center">
      <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
        Nothing here yet
      </p>
      <h1 className="mt-3 text-2xl font-bold text-white">
        Your listings will appear here
      </h1>
      <p className="mt-3 text-sm text-ink-muted">
        Once we've confirmed a shoot for you, it'll show up as a listing with
        photos, virtual tour, and floor plan — all in one place.
      </p>
      <a
        href="/book"
        className="mt-6 inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light"
      >
        Book a shoot
      </a>
    </div>
  );
}

function pickLatestBooking(
  bookings: PropertyRow["bookings"],
): PropertyRow["bookings"][number] | null {
  if (!bookings || bookings.length === 0) return null;
  // Prefer scheduled_at, fall back to created_at.
  return [...bookings].sort((a, b) => {
    const aT =
      new Date(a.scheduled_at ?? a.created_at).getTime() || 0;
    const bT =
      new Date(b.scheduled_at ?? b.created_at).getTime() || 0;
    return bT - aT;
  })[0];
}
