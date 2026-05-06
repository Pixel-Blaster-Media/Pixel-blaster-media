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

import ArchiveListingButton from "./ArchiveListingButton";

export const metadata: Metadata = { title: "My listings" };
export const dynamic = "force-dynamic";

interface PropertyRow {
  id: string;
  street_address: string;
  city: string | null;
  postal_code: string | null;
  archived_at: string | null;
  bookings: {
    id: string;
    status: BookingStatus;
    scheduled_at: string | null;
    services: string[];
    add_ons: string[];
    square_footage: number | null;
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

export default async function PortalIndex({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; password_updated?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser("/portal");
  const supabase = await getServerSupabase();
  const archivedView = params.archived === "1";

  // RLS scopes these selects to the current user — realtors only see
  // their own properties / bookings / deliverables.
  let query = supabase
    .from("properties")
    .select(
      "id, street_address, city, postal_code, archived_at, bookings(id, status, scheduled_at, services, add_ons, square_footage, created_at)",
    )
    .eq("owner_id", user.userId)
    .order("created_at", { ascending: false });
  query = archivedView
    ? query.not("archived_at", "is", null)
    : query.is("archived_at", null);
  const { data: properties } = await query.returns<PropertyRow[]>();

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
    return <EmptyState archivedView={archivedView} />;
  }

  return (
    <div className="space-y-6">
      {params.password_updated === "1" ? (
        <section className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4">
          <p className="text-sm font-semibold text-white">
            Your password has been updated.
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Use this password next time you sign in to your media portal.
          </p>
        </section>
      ) : null}

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

      <div className="flex flex-wrap gap-2">
        <PortalTab href="/portal" active={!archivedView}>
          Active listings
        </PortalTab>
        <PortalTab href="/portal?archived=1" active={archivedView}>
          Archived
        </PortalTab>
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
          const similarHref = buildSimilarBookingHref(p, latestBooking);

          return (
            <li key={p.id}>
              <article className="group overflow-hidden rounded-xl border border-white/10 bg-ink-soft/50 transition hover:border-brand/40 hover:bg-ink-soft">
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
                  <div>
                    <p className="font-semibold text-white">
                      {p.street_address}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {[p.city, p.postal_code].filter(Boolean).join(" ")}
                    </p>
                  </div>
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
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3 text-xs">
                    <Link
                      href={`/portal/${p.id}`}
                      className="font-semibold text-brand-light hover:text-white"
                    >
                      Open media →
                    </Link>
                    <span className="text-ink-muted md:ml-auto">
                      {media.readyCount > 0
                        ? `${media.readyCount} item${media.readyCount === 1 ? "" : "s"} ready`
                        : "Media will appear here"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={similarHref}
                      className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-light"
                    >
                      Book similar shoot
                    </Link>
                    <ArchiveListingButton
                      propertyId={p.id}
                      archived={Boolean(p.archived_at)}
                    />
                  </div>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PortalTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        "rounded-md border px-3 py-1.5 text-xs font-semibold transition " +
        (active
          ? "border-brand-light bg-brand/15 text-brand-light"
          : "border-white/10 text-ink-muted hover:border-white/30 hover:text-white")
      }
    >
      {children}
    </Link>
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

function buildSimilarBookingHref(
  property: PropertyRow,
  booking: PropertyRow["bookings"][number] | null,
): string {
  const params = new URLSearchParams();
  if (booking?.services.length) params.set("services", booking.services.join(","));
  if (booking?.add_ons.length) params.set("add_ons", booking.add_ons.join(","));
  params.set("street_address", property.street_address);
  if (property.city) params.set("city", property.city);
  if (property.postal_code) params.set("postal_code", property.postal_code);
  if (booking?.square_footage) {
    params.set("square_footage", String(booking.square_footage));
  }
  const qs = params.toString();
  return qs ? `/portal/book?${qs}` : "/portal/book";
}

function EmptyState({ archivedView }: { archivedView: boolean }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-dashed border-white/10 bg-ink-soft/40 p-8 text-center">
      <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
        {archivedView ? "Archive is empty" : "Nothing here yet"}
      </p>
      <h1 className="mt-3 text-2xl font-bold text-white">
        {archivedView
          ? "Archived listings will appear here"
          : "Your listings will appear here"}
      </h1>
      <p className="mt-3 text-sm text-ink-muted">
        {archivedView
          ? "Archive old shoots from the active dashboard when you want to keep things tidy."
          : "Once we've confirmed a shoot for you, it'll show up as a listing with photos, virtual tour, and floor plan — all in one place."}
      </p>
      <a
        href={archivedView ? "/portal" : "/book"}
        className="mt-6 inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light"
      >
        {archivedView ? "Back to active listings" : "Book a shoot"}
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
