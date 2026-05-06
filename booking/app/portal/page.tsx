import Link from "next/link";
import type { Metadata } from "next";

import { BOOKING_STATUSES } from "@/lib/booking/booking-status";
import { requireUser } from "@/lib/auth/require-user";
import { getServerSupabase } from "@/lib/supabase/server";
import type {
  BookingStatus,
  DeliverableSource,
  DeliverableType,
} from "@/lib/supabase/database.types";

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
  type: DeliverableType;
  source: DeliverableSource;
  ready_at: string | null;
  thumbnail_url: string | null;
  created_at: string;
}

interface PropertyMediaSummary {
  readyCount: number;
  pendingCount: number;
  hasPhotos: boolean;
  hasTour: boolean;
  hasFloorPlan: boolean;
  hasVideo: boolean;
}

export default async function PortalIndex() {
  const user = await requireUser("/portal");
  const supabase = await getServerSupabase();

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

  // Pull media summary separately to keep the primary property select simple.
  const propertyIds = (properties ?? []).map((p) => p.id);
  const thumbnails = new Map<string, string>();
  const mediaByProperty = new Map<string, PropertyMediaSummary>();
  if (propertyIds.length > 0) {
    const { data: deliverables } = await supabase
      .from("deliverables")
      .select("property_id, type, source, ready_at, thumbnail_url, created_at")
      .in("property_id", propertyIds)
      .order("created_at", { ascending: false })
      .returns<DeliverableRow[]>();

    for (const d of deliverables ?? []) {
      if (d.thumbnail_url && !thumbnails.has(d.property_id)) {
        thumbnails.set(d.property_id, d.thumbnail_url);
      }
      const current =
        mediaByProperty.get(d.property_id) ?? emptyMediaSummary();
      if (d.ready_at) current.readyCount += 1;
      else current.pendingCount += 1;
      if (d.ready_at && d.type === "photo_gallery") current.hasPhotos = true;
      if (d.ready_at && d.type === "virtual_tour") current.hasTour = true;
      if (d.ready_at && d.type === "floor_plan") current.hasFloorPlan = true;
      if (d.ready_at && (d.type === "video" || d.type === "aerial")) {
        current.hasVideo = true;
      }
      mediaByProperty.set(d.property_id, current);
    }
  }

  if (!properties || properties.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
            Realtor portal
          </p>
          <h1 className="mt-1 text-3xl font-bold text-white">My listings</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">
            Open a listing to grab photos, tours, floor plans, video links, and
            property website links in one place.
          </p>
        </div>
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
          const media = mediaByProperty.get(p.id) ?? emptyMediaSummary();
          const dateLabel = latestBooking?.scheduled_at
            ? formatDate(latestBooking.scheduled_at)
            : null;

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
                <div className="space-y-3 p-4">
                  <p className="font-semibold text-white">
                    {p.street_address}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {[p.city, p.postal_code].filter(Boolean).join(" ")}
                  </p>
                  {meta ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${meta.pill}`}
                      >
                        {meta.label}
                      </span>
                      {dateLabel ? (
                        <span className="text-[11px] text-ink-muted">
                          {dateLabel}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <MediaChips media={media} />
                  <div className="flex items-center justify-between border-t border-white/5 pt-3 text-xs">
                    <span className="text-ink-muted">
                      {media.readyCount > 0
                        ? `${media.readyCount} item${media.readyCount === 1 ? "" : "s"} ready`
                        : "Media will appear here"}
                    </span>
                    <span className="font-semibold text-brand-light">
                      Open media →
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function emptyMediaSummary(): PropertyMediaSummary {
  return {
    readyCount: 0,
    pendingCount: 0,
    hasPhotos: false,
    hasTour: false,
    hasFloorPlan: false,
    hasVideo: false,
  };
}

function MediaChips({ media }: { media: PropertyMediaSummary }) {
  const chips = [
    media.hasPhotos ? "Photos" : null,
    media.hasTour ? "Tour" : null,
    media.hasFloorPlan ? "Floor plan" : null,
    media.hasVideo ? "Video" : null,
  ].filter((chip): chip is string => Boolean(chip));

  if (chips.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-white/10 bg-black/20 px-3 py-2 text-xs text-ink-muted">
        Nothing delivered yet.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-full border border-brand-light/25 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-light"
        >
          {chip}
        </span>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
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
