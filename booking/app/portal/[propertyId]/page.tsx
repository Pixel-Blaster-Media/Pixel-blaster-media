import Link from "next/link";
import { notFound } from "next/navigation";

import {
  BOOKING_STATUSES,
  deliverableTypeLabel,
  isCancellable,
} from "@/lib/booking/booking-status";
import { requireUser } from "@/lib/auth/require-user";
import {
  iguideEmbedUrl,
  parseIGuideAlias,
} from "@/lib/integrations/iguide/parse-id";
import { getServerSupabase } from "@/lib/supabase/server";
import type {
  BookingStatus,
  DeliverableSource,
  DeliverableType,
} from "@/lib/supabase/database.types";

import CancelBookingButton from "./CancelBookingButton";
import CopyLinkButton from "./CopyLinkButton";

export const dynamic = "force-dynamic";

interface PropertyRow {
  id: string;
  street_address: string;
  city: string | null;
  postal_code: string | null;
  owner_id: string;
  bookings: {
    id: string;
    status: BookingStatus;
    scheduled_at: string | null;
    services: string[];
    created_at: string;
  }[];
}

interface DeliverableRow {
  id: string;
  booking_id: string;
  type: DeliverableType;
  source: DeliverableSource;
  url: string;
  thumbnail_url: string | null;
  ready_at: string | null;
  created_at: string;
}

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  await requireUser(`/portal/${propertyId}`);
  const supabase = await getServerSupabase();

  // RLS will ensure the row is only returned if the caller owns it (or
  // is admin). .maybeSingle() so a non-owner just gets 404, not 500.
  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, street_address, city, postal_code, owner_id, bookings(id, status, scheduled_at, services, created_at)",
    )
    .eq("id", propertyId)
    .maybeSingle<PropertyRow>();

  if (!property) notFound();

  const { data: deliverables } = await supabase
    .from("deliverables")
    .select(
      "id, booking_id, type, source, url, thumbnail_url, ready_at, created_at",
    )
    .eq("property_id", property.id)
    .order("created_at", { ascending: false })
    .returns<DeliverableRow[]>();

  const tour = (deliverables ?? []).find((d) => d.type === "virtual_tour");
  const floorPlan = (deliverables ?? []).find((d) => d.type === "floor_plan");
  // Only show galleries that have actually been published — in-progress
  // Fotello enhances are tracked but not shown to the realtor yet.
  const gallery = (deliverables ?? []).filter(
    (d) => d.type === "photo_gallery" && d.ready_at,
  );
  const videos = (deliverables ?? []).filter(
    (d) => d.type === "video" || d.type === "aerial",
  );

  const latestBooking = pickLatest(property.bookings);
  const statusMeta = latestBooking
    ? BOOKING_STATUSES[latestBooking.status]
    : null;

  return (
    <div className="space-y-10">
      <Link
        href="/portal"
        className="text-xs text-ink-muted hover:text-white"
      >
        ← My listings
      </Link>

      <header>
        <h1 className="text-3xl font-bold text-white">
          {property.street_address}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {[property.city, property.postal_code].filter(Boolean).join(" ")}
        </p>
        {statusMeta && latestBooking ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            <span
              className={`rounded-full border px-2 py-0.5 uppercase tracking-wider ${statusMeta.pill}`}
            >
              {statusMeta.label}
            </span>
            {latestBooking.scheduled_at ? (
              <span className="text-ink-muted">
                {new Date(latestBooking.scheduled_at).toLocaleString()}
              </span>
            ) : null}
            {isCancellable(latestBooking.status) ? (
              <CancelBookingButton
                bookingId={latestBooking.id}
                whenLabel={
                  latestBooking.scheduled_at
                    ? new Date(latestBooking.scheduled_at).toLocaleString()
                    : null
                }
              />
            ) : null}
          </div>
        ) : null}
      </header>

      {/* Virtual tour — the marquee deliverable. Renders our own iframe
          rather than the stored embed_html so we never inject arbitrary
          HTML, even from first-party sources. */}
      {tour ? (
        <section>
          <SectionHeader
            title="Virtual tour"
            source={tour.source}
            actions={
              <div className="flex gap-2">
                <CopyLinkButton url={tour.url} label="Copy tour link" />
                <a
                  href={tour.url}
                  target="_blank"
                  rel="noopener"
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-light"
                >
                  Open tour ↗
                </a>
              </div>
            }
          />
          <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
            <div className="aspect-[16/10] w-full">
              <iframe
                src={tourEmbedUrl(tour.url)}
                title="Virtual tour"
                className="h-full w-full border-0"
                allowFullScreen
                loading="lazy"
              />
            </div>
          </div>
        </section>
      ) : (
        <EmptySection
          title="Virtual tour"
          message="Your virtual tour will appear here once we've published it."
        />
      )}

      {/* Floor plan — keep it simple: open/download button. PDFs embed
          awkwardly across browsers; we'd rather give the realtor a
          clean download link they can forward. */}
      {floorPlan ? (
        <section>
          <SectionHeader
            title="Floor plan"
            source={floorPlan.source}
            actions={
              <CopyLinkButton
                url={floorPlan.url}
                label="Copy floor plan link"
              />
            }
          />
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-ink-soft/50 p-4">
            <a
              href={floorPlan.url}
              target="_blank"
              rel="noopener"
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light"
            >
              Open floor plan PDF ↗
            </a>
            <p className="text-xs text-ink-muted">
              Measured floor plan, ready to drop into your listing.
            </p>
          </div>
        </section>
      ) : (
        <EmptySection
          title="Floor plan"
          message="Floor plan will appear here once iGuide has processed the measurements."
        />
      )}

      {gallery.length > 0 ? (
        <section className="space-y-6">
          <SectionHeader title="Photos" />
          {gallery.map((g) =>
            g.source === "fotello" ? (
              <FotelloGallery key={g.id} deliverable={g} />
            ) : (
              <ManualGallery key={g.id} deliverable={g} />
            ),
          )}
        </section>
      ) : null}

      {videos.length > 0 ? (
        <section>
          <SectionHeader title="Video" />
          <ul className="grid gap-3 md:grid-cols-2">
            {videos.map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-soft/50 p-4"
              >
                <p className="text-sm font-semibold text-white">
                  {deliverableTypeLabel(v.type)}
                </p>
                <div className="flex gap-2">
                  <CopyLinkButton url={v.url} />
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noopener"
                    className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-light"
                  >
                    Open ↗
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function tourEmbedUrl(url: string): string {
  const alias = parseIGuideAlias(url);
  return alias ? iguideEmbedUrl(alias) : url;
}

function SectionHeader({
  title,
  source,
  actions,
}: {
  title: string;
  source?: DeliverableSource;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
          {title}
        </h2>
        {source ? (
          <p className="text-[10px] uppercase tracking-wider text-ink-muted">
            via {source}
          </p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}

function EmptySection({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <section>
      <SectionHeader title={title} />
      <p className="rounded-xl border border-dashed border-white/10 bg-ink-soft/40 p-4 text-sm text-ink-muted">
        {message}
      </p>
    </section>
  );
}

/**
 * Fotello-sourced gallery: iframe via our proxy route so we serve fresh
 * signed URLs transparently. If the browser refuses to frame it (some
 * hosts set X-Frame-Options / CSP), realtors still have the "Open in
 * new tab" button to fall back on.
 */
function FotelloGallery({ deliverable }: { deliverable: DeliverableRow }) {
  const embedSrc = `/api/fotello/embed/${deliverable.id}`;
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-ink-soft/50">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-4 py-2">
        <p className="text-xs text-ink-muted">
          via fotello
        </p>
        <div className="flex gap-2">
          <CopyLinkButton url={embedSrc} label="Copy gallery link" />
          <a
            href={embedSrc}
            target="_blank"
            rel="noopener"
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-light"
          >
            Open ↗
          </a>
        </div>
      </div>
      <div className="bg-black">
        <div className="aspect-[16/10] w-full">
          <iframe
            src={embedSrc}
            title="Photo gallery"
            className="h-full w-full border-0"
            loading="lazy"
          />
        </div>
      </div>
    </div>
  );
}

/** Manually-pasted gallery URL — just a button row, no iframe. */
function ManualGallery({ deliverable }: { deliverable: DeliverableRow }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-soft/50 p-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">Photo gallery</p>
        <p className="mt-0.5 truncate text-xs text-ink-muted">
          {deliverable.url}
        </p>
      </div>
      <div className="flex gap-2">
        <CopyLinkButton url={deliverable.url} />
        <a
          href={deliverable.url}
          target="_blank"
          rel="noopener"
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-light"
        >
          Open ↗
        </a>
      </div>
    </div>
  );
}

function pickLatest(
  bookings: PropertyRow["bookings"],
): PropertyRow["bookings"][number] | null {
  if (!bookings || bookings.length === 0) return null;
  return [...bookings].sort((a, b) => {
    const aT = new Date(a.scheduled_at ?? a.created_at).getTime() || 0;
    const bT = new Date(b.scheduled_at ?? b.created_at).getTime() || 0;
    return bT - aT;
  })[0];
}
