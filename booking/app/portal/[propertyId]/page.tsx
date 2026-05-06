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
  iguideFloorplanMetricPdfUrl,
  iguideFloorplanPdfUrl,
  iguideUnbrandedUrl,
  iguideViewerUrl,
  parseIGuideAlias,
} from "@/lib/integrations/iguide/parse-id";
import {
  fetchIGuideRESO,
  type IGuideRESOResponse,
} from "@/lib/integrations/iguide/client";
import { getServerSupabase } from "@/lib/supabase/server";
import type {
  BookingStatus,
  DeliverableSource,
  DeliverableType,
  Json,
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
  metadata: Json | null;
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
      "id, booking_id, type, source, url, thumbnail_url, metadata, ready_at, created_at",
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
  const videoDownloads = videos.filter((video) => !isStreamingVideoUrl(video.url));
  const videoStreamingLinks = videos.filter((video) =>
    isStreamingVideoUrl(video.url),
  );
  const iGuideAlias = pickIGuideAlias(tour, floorPlan);
  const iGuideReso = iGuideAlias ? await fetchOptionalIGuideRESO(iGuideAlias) : null;

  const latestBooking = pickLatest(property.bookings);
  const statusMeta = latestBooking
    ? BOOKING_STATUSES[latestBooking.status]
    : null;

  return (
    <div className="space-y-8">
      <Link
        href="/portal"
        className="text-xs text-ink-muted hover:text-white"
      >
        ← My listings
      </Link>

      <header className="rounded-lg border border-white/10 bg-ink-soft/50 p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
          Media delivery
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">
              {property.street_address}
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              {[property.city, property.postal_code].filter(Boolean).join(" ")}
            </p>
          </div>
          {tour ? (
            <a
              href={tour.url}
              target="_blank"
              rel="noopener"
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light"
            >
              Open virtual tour ↗
            </a>
          ) : null}
        </div>
        {statusMeta && latestBooking ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
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
              href={iGuideDownloadUrl(floorPlan.url)}
              target="_blank"
              rel="noopener"
              download
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light"
            >
              Download floor plan PDF
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

      {iGuideAlias ? (
        <IGuideDeliverySheet
          alias={iGuideAlias}
          tour={tour ?? null}
          floorPlan={floorPlan ?? null}
          reso={iGuideReso}
        />
      ) : null}

      {gallery.length > 0 ? (
        <section className="space-y-6">
          <SectionHeader title="Photos" />
          {gallery.map((g) =>
            g.source === "fotello" && !metadataString(g.metadata, "delivery_kind") ? (
              <FotelloGallery key={g.id} deliverable={g} />
            ) : (
              <ManualGallery key={g.id} deliverable={g} />
            ),
          )}
        </section>
      ) : null}

      {videos.length > 0 ? (
        <VideoSection
          downloads={videoDownloads}
          streamingLinks={videoStreamingLinks}
        />
      ) : null}
    </div>
  );
}

function tourEmbedUrl(url: string): string {
  const alias = parseIGuideAlias(url);
  return alias ? iguideEmbedUrl(alias) : url;
}

async function fetchOptionalIGuideRESO(
  alias: string,
): Promise<IGuideRESOResponse | null> {
  const res = await fetchIGuideRESO(alias);
  return res.ok && res.data ? res.data : null;
}

function pickIGuideAlias(
  tour: DeliverableRow | undefined,
  floorPlan: DeliverableRow | undefined,
): string | null {
  return (
    metadataString(tour?.metadata, "alias") ??
    metadataString(floorPlan?.metadata, "alias") ??
    (tour ? parseIGuideAlias(tour.url) : null) ??
    (floorPlan ? parseIGuideAlias(floorPlan.url) : null)
  );
}

function IGuideDeliverySheet({
  alias,
  tour,
  floorPlan,
  reso,
}: {
  alias: string;
  tour: DeliverableRow | null;
  floorPlan: DeliverableRow | null;
  reso: IGuideRESOResponse | null;
}) {
  const brandedUrl = metadataString(tour?.metadata, "branded_url") ?? iguideViewerUrl(alias);
  const unbrandedUrl =
    metadataString(tour?.metadata, "unbranded_url") ?? iguideUnbrandedUrl(alias);
  const pdfImperial =
    metadataString(floorPlan?.metadata, "pdf_imperial") ??
    (floorPlan?.url.includes("floorplan_imperial") ? floorPlan.url : null) ??
    iguideFloorplanPdfUrl(alias);
  const pdfMetric =
    metadataString(floorPlan?.metadata, "pdf_metric") ??
    (floorPlan?.url.includes("floorplan_metric") ? floorPlan.url : null) ??
    iguideFloorplanMetricPdfUrl(alias);

  const tourLinks = [
    { label: "Branded tour", url: brandedUrl },
    { label: "Unbranded tour", url: unbrandedUrl },
  ];
  const downloadLinks = [
    { label: "Floor plan PDF (feet)", url: pdfImperial },
    { label: "Floor plan PDF (meters)", url: pdfMetric },
    {
      label: "Property overview PDF (feet)",
      url: `https://youriguide.com/${alias}/doc/branded_property_overview_imperial.pdf`,
    },
    {
      label: "Property overview PDF (meters)",
      url: `https://youriguide.com/${alias}/doc/branded_property_overview_metric.pdf`,
    },
  ];

  const tools = [
    {
      label: "Feature sheet creator",
      url: `https://manage.youriguide.com/feature_sheet/?g=${alias}`,
    },
    {
      label: "Embedding tool",
      url: `https://manage.youriguide.com/embed/${alias}/`,
    },
    {
      label: "Create virtual showing",
      url: `https://show.youriguide.com/create?url=${encodeURIComponent(
        iguideViewerUrl(alias),
      )}`,
    },
  ];

  const areaRows = floorAreaRows(reso);

  return (
    <section className="space-y-4">
      <SectionHeader title="iGUIDE delivery links" source="iguide" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px]">
        <div className="rounded-lg border border-white/10 bg-ink-soft/50 p-4">
          <h3 className="text-sm font-semibold text-white">Tour links</h3>
          <p className="text-xs text-ink-muted">
            Check your MLS/board policy before using branded virtual tours.
          </p>
          <div className="mt-3 grid gap-2">
            {tourLinks.map((link) => (
              <LinkRow key={link.label} label={link.label} url={link.url} />
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-ink-soft/50 p-4">
          <h3 className="text-sm font-semibold text-white">Downloads</h3>
          <p className="text-xs text-ink-muted">
            Floor plans and overview PDFs for listing paperwork.
          </p>
          <div className="mt-3 grid gap-2">
            {downloadLinks.map((link) => (
              <LinkRow
                key={link.label}
                label={link.label}
                url={link.url}
                actionLabel="Download"
                download
              />
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-ink-soft/50 p-4">
          <h3 className="text-sm font-semibold text-white">Tools</h3>
          <div className="mt-3 grid gap-2">
            {tools.map((tool) => (
              <LinkRow key={tool.label} label={tool.label} url={tool.url} compact />
            ))}
          </div>
        </div>
      </div>

      {areaRows.length > 0 ? (
        <div className="rounded-xl border border-white/10 bg-ink-soft/50 p-4">
          <h3 className="text-sm font-semibold text-white">Floor area information</h3>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {areaRows.map((row) => (
              <div key={row.label}>
                <dt className="text-xs uppercase tracking-wider text-ink-muted">
                  {row.label}
                </dt>
                <dd className="mt-1 text-sm font-semibold text-white">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  );
}

function LinkRow({
  label,
  url,
  compact = false,
  actionLabel = "Open ↗",
  download = false,
}: {
  label: string;
  url: string;
  compact?: boolean;
  actionLabel?: string;
  download?: boolean;
}) {
  const href = download ? iGuideDownloadUrl(url) : url;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/10 bg-ink/40 p-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-white">{label}</p>
        {!compact ? (
          <p className="mt-0.5 truncate text-[11px] text-ink-muted">{url}</p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <CopyLinkButton url={url} label="Copy" />
        <a
          href={href}
          target="_blank"
          rel="noopener"
          download={download}
          className="rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-light"
        >
          {actionLabel}
        </a>
      </div>
    </div>
  );
}

function iGuideDownloadUrl(url: string): string {
  return `/api/iguide/download?url=${encodeURIComponent(url)}`;
}

function VideoSection({
  downloads,
  streamingLinks,
}: {
  downloads: DeliverableRow[];
  streamingLinks: DeliverableRow[];
}) {
  return (
    <section className="space-y-4">
      <SectionHeader title="Video" />
      <div className="grid gap-4 lg:grid-cols-2">
        <VideoGroup
          title="Downloadable video"
          description="Use this for MLS uploads, social edits, or saving the final file."
          empty="No downloadable video file has been added yet."
          videos={downloads}
          actionLabel="Download"
        />
        <VideoGroup
          title="YouTube / viewing link"
          description="Use this for easy sharing, embeds, or public video pages."
          empty="No YouTube or viewing link has been added yet."
          videos={streamingLinks}
          actionLabel="Open video ↗"
        />
      </div>
    </section>
  );
}

function VideoGroup({
  title,
  description,
  empty,
  videos,
  actionLabel,
}: {
  title: string;
  description: string;
  empty: string;
  videos: DeliverableRow[];
  actionLabel: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-ink-soft/50 p-4">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-1 text-xs text-ink-muted">{description}</p>
      {videos.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {videos.map((video) => (
            <li
              key={video.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 bg-ink/40 p-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white">
                  {metadataString(video.metadata, "delivery_label") ??
                    deliverableTypeLabel(video.type)}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                  {video.url}
                </p>
              </div>
              <div className="flex gap-2">
                <CopyLinkButton url={video.url} label="Copy" />
                <a
                  href={video.url}
                  target="_blank"
                  rel="noopener"
                  download={actionLabel === "Download"}
                  className="rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-light"
                >
                  {actionLabel}
                </a>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-md border border-dashed border-white/10 bg-ink/30 p-3 text-xs text-ink-muted">
          {empty}
        </p>
      )}
    </div>
  );
}

function isStreamingVideoUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return [
      "youtube.com",
      "youtu.be",
      "vimeo.com",
      "player.vimeo.com",
      "facebook.com",
      "instagram.com",
      "tiktok.com",
    ].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function metadataString(metadata: Json | null | undefined, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function floorAreaRows(reso: IGuideRESOResponse | null): Array<{
  label: string;
  value: string;
}> {
  if (!reso) return [];
  return [
    ["Interior area", reso.AboveGradeInteriorArea],
    ["Exterior area", reso.AboveGradeExteriorArea],
    ["Below grade interior", reso.BelowGradeInteriorArea],
    ["Below grade exterior", reso.BelowGradeExteriorArea],
    ["Finished area", reso.AboveGradeFinishedArea],
    ["Living area", reso.LivingArea],
  ]
    .filter((row): row is [string, number] => typeof row[1] === "number")
    .map(([label, value]) => ({
      label,
      value: `${formatNumber(value)} sq ft`,
    }));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
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
  const label =
    metadataString(deliverable.metadata, "delivery_label") ?? "Photo gallery";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-soft/50 p-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{label}</p>
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
