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
import AiCopyPanel from "./AiCopyPanel";

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
    add_ons: string[];
    square_footage: number | null;
    created_at: string;
    quickbooks_invoice_number: string | null;
    quickbooks_invoice_url: string | null;
    quickbooks_invoice_status: string | null;
    quickbooks_invoice_total_cents: number | null;
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
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ booked?: string }>;
}) {
  const { propertyId } = await params;
  const query = await searchParams;
  await requireUser(`/portal/${propertyId}`);
  const supabase = await getServerSupabase();

  // RLS will ensure the row is only returned if the caller owns it (or
  // is admin). .maybeSingle() so a non-owner just gets 404, not 500.
  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, street_address, city, postal_code, owner_id, bookings(id, status, scheduled_at, services, add_ons, square_footage, created_at, quickbooks_invoice_number, quickbooks_invoice_url, quickbooks_invoice_status, quickbooks_invoice_total_cents)",
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

  const readyDeliverables = (deliverables ?? []).filter((d) => d.ready_at);
  const fotelloPropertyWebsites = readyDeliverables.filter((d) => {
    const kind = metadataString(d.metadata, "delivery_kind");
    return (
      d.source === "fotello" &&
      (kind === "branded_property_website" ||
        kind === "unbranded_property_website")
    );
  });
  const tour = readyDeliverables.find(
    (d) =>
      d.type === "virtual_tour" &&
      !(d.source === "fotello" && metadataString(d.metadata, "delivery_kind")),
  );
  const floorPlan = readyDeliverables.find((d) => d.type === "floor_plan");
  // Only show galleries that have actually been published — in-progress
  // Fotello enhances are tracked but not shown to the realtor yet.
  const gallery = readyDeliverables.filter(
    (d) => d.type === "photo_gallery" && d.ready_at,
  );
  const videos = readyDeliverables.filter(
    (d) => d.type === "video" || d.type === "aerial",
  );
  const videoDownloads = videos.filter((video) => !isStreamingVideoUrl(video.url));
  const videoStreamingLinks = videos.filter((video) =>
    isStreamingVideoUrl(video.url),
  );
  const iGuideAlias = pickIGuideAlias(tour, floorPlan);
  const iGuideReso = iGuideAlias ? await fetchOptionalIGuideRESO(iGuideAlias) : null;

  const latestBooking = pickLatest(property.bookings);
  const similarHref = buildSimilarBookingHref(property, latestBooking);
  const statusMeta = latestBooking
    ? BOOKING_STATUSES[latestBooking.status]
    : null;
  const readySummary = {
    photos: gallery.length,
    tour: Boolean(tour),
    floorPlan: Boolean(floorPlan),
    video: videos.length,
    websites: fotelloPropertyWebsites.length,
    invoice: Boolean(latestBooking?.quickbooks_invoice_url),
  };

  return (
    <div className="realtor-theme space-y-8">
      <Link
        href="/portal"
        className="text-xs text-realtor-muted hover:text-realtor-text"
      >
        ← My listings
      </Link>

      {query.booked === "1" ? (
        <section className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4">
          <p className="text-sm font-semibold text-realtor-text">
            Your booking is confirmed.
          </p>
          <p className="mt-1 text-xs text-realtor-muted">
            You are signed in now. To come back later, use the same email and
            password from the booking form at the sign-in page.
          </p>
        </section>
      ) : null}

      <header className="realtor-elevated-panel rounded-2xl p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-realtor-primary">
          Media delivery
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-realtor-text">
              {property.street_address}
            </h1>
            <p className="mt-1 text-sm text-realtor-muted">
              {[property.city, property.postal_code].filter(Boolean).join(" ")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={similarHref}
              className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-realtor-primary/20 transition hover:bg-realtor-primary-light"
            >
              Book similar shoot
            </Link>
            {tour ? (
              <a
                href={tour.url}
                target="_blank"
                rel="noopener"
                className="rounded-full border border-realtor-primary/20 bg-realtor-surface px-4 py-2 text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:text-realtor-text"
              >
                Open virtual tour ↗
              </a>
            ) : null}
          </div>
        </div>
        {statusMeta && latestBooking ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
            <span
              className={`rounded-full border px-2 py-0.5 uppercase tracking-wider ${statusMeta.pill}`}
            >
              {statusMeta.label}
            </span>
            {latestBooking.scheduled_at ? (
              <span className="text-realtor-muted">
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

      <MediaKitOverview summary={readySummary} />

      <AiCopyPanel propertyId={property.id} />

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
                  className="rounded-md bg-realtor-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-realtor-primary-light"
                >
                  Open tour ↗
                </a>
              </div>
            }
          />
          <div className="overflow-hidden rounded-2xl border border-realtor-primary/15 bg-realtor-text shadow-lg shadow-realtor-primary/10">
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
          <div className="realtor-warm-panel flex flex-wrap items-center gap-3 rounded-2xl p-4">
            <a
              href={iGuideDownloadUrl(floorPlan.url)}
              target="_blank"
              rel="noopener"
              download
              className="rounded-md bg-realtor-primary px-4 py-2 text-sm font-semibold text-white hover:bg-realtor-primary-light"
            >
              Download floor plan PDF
            </a>
            <p className="text-xs text-realtor-muted">
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

      {fotelloPropertyWebsites.length > 0 ? (
        <section className="space-y-3">
          <SectionHeader title="Property websites" source="fotello" />
          <div className="grid gap-3 md:grid-cols-2">
            {fotelloPropertyWebsites.map((link) => (
              <ManualGallery key={link.id} deliverable={link} />
            ))}
          </div>
        </section>
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

      {latestBooking?.quickbooks_invoice_url ? (
        <InvoiceCard booking={latestBooking} />
      ) : null}
    </div>
  );
}

function MediaKitOverview({
  summary,
}: {
  summary: {
    photos: number;
    tour: boolean;
    floorPlan: boolean;
    video: number;
    websites: number;
    invoice: boolean;
  };
}) {
  const items = [
    {
      label: "Photos",
      ready: summary.photos > 0,
      detail: summary.photos > 0 ? `${summary.photos} gallery/link` : "Pending",
    },
    {
      label: "Virtual tour",
      ready: summary.tour,
      detail: summary.tour ? "Ready" : "Pending",
    },
    {
      label: "Floor plans",
      ready: summary.floorPlan,
      detail: summary.floorPlan ? "Ready" : "Pending",
    },
    {
      label: "Video",
      ready: summary.video > 0,
      detail: summary.video > 0 ? `${summary.video} link` : "Pending",
    },
    {
      label: "Property websites",
      ready: summary.websites > 0,
      detail: summary.websites > 0 ? `${summary.websites} link` : "Optional",
    },
    {
      label: "Invoice",
      ready: summary.invoice,
      detail: summary.invoice ? "Available" : "Optional",
    },
  ];
  const readyCount = items.filter((item) => item.ready).length;

  return (
    <section className="realtor-elevated-panel rounded-2xl p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-realtor-primary">
            Media kit
          </p>
          <h2 className="mt-1 text-xl font-semibold text-realtor-text">
            Everything ready in one place
          </h2>
        </div>
        <p className="rounded-full border border-realtor-primary/20 px-3 py-1 text-xs font-semibold text-realtor-primary">
          {readyCount} of {items.length} ready
        </p>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div
            key={item.label}
            className={
              "rounded-2xl border p-3 " +
              (item.ready
                ? "border-realtor-primary/25 bg-realtor-primary/10"
                : "border-realtor-primary/15 bg-realtor-surface-muted/75")
            }
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-realtor-muted">
                {item.label}
              </p>
              <span
                className={
                  "h-2.5 w-2.5 rounded-full " +
                  (item.ready ? "bg-realtor-primary" : "bg-realtor-accent/70")
                }
                aria-hidden="true"
              />
            </div>
            <p
              className={
                "mt-1 text-sm font-semibold " +
                (item.ready ? "text-realtor-primary" : "text-realtor-muted")
              }
            >
              {item.detail}
            </p>
          </div>
        ))}
      </div>
    </section>
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
        <div className="realtor-elevated-panel min-w-0 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-realtor-text">Tour links</h3>
          <p className="text-xs text-realtor-muted">
            Check your MLS/board policy before using branded virtual tours.
          </p>
          <div className="mt-3 grid gap-2">
            {tourLinks.map((link) => (
              <LinkRow key={link.label} label={link.label} url={link.url} />
            ))}
          </div>
        </div>

        <div className="realtor-warm-panel min-w-0 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-realtor-text">Downloads</h3>
          <p className="text-xs text-realtor-muted">
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

        <div className="realtor-green-panel min-w-0 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-realtor-text">Tools</h3>
          <div className="mt-3 grid gap-2">
            {tools.map((tool) => (
              <LinkRow key={tool.label} label={tool.label} url={tool.url} compact />
            ))}
          </div>
        </div>
      </div>

      {areaRows.length > 0 ? (
        <div className="realtor-elevated-panel rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-realtor-text">Floor area information</h3>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {areaRows.map((row) => (
              <div key={row.label}>
                <dt className="text-xs uppercase tracking-wider text-realtor-muted">
                  {row.label}
                </dt>
                <dd className="mt-1 text-sm font-semibold text-realtor-text">
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
    <div className="grid min-w-0 gap-3 rounded-2xl border border-realtor-primary/15 bg-realtor-surface-muted/80 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0 overflow-hidden">
        <p className="truncate text-xs font-semibold text-realtor-text">{label}</p>
        {!compact ? (
          <p
            className="mt-0.5 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-realtor-muted"
            title={url}
          >
            {url}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
        <CopyLinkButton url={url} label="Copy" />
        <a
          href={href}
          target="_blank"
          rel="noopener"
          download={download}
          className="rounded-md bg-realtor-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-realtor-primary-light"
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
    <div className="realtor-elevated-panel rounded-2xl p-4">
      <h3 className="text-sm font-semibold text-realtor-text">{title}</h3>
      <p className="mt-1 text-xs text-realtor-muted">{description}</p>
      {videos.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {videos.map((video) => (
            <li
              key={video.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-realtor-primary/15 bg-realtor-surface-muted/80 p-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold text-realtor-text">
                  {metadataString(video.metadata, "delivery_label") ??
                    deliverableTypeLabel(video.type)}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-realtor-muted">
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
                  className="rounded-md bg-realtor-primary px-2.5 py-1 text-xs font-semibold text-white hover:bg-realtor-primary-light"
                >
                  {actionLabel}
                </a>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-md border border-dashed border-realtor-primary/15 bg-realtor-surface-muted/70 p-3 text-xs text-realtor-muted">
          {empty}
        </p>
      )}
    </div>
  );
}

function InvoiceCard({
  booking,
}: {
  booking: PropertyRow["bookings"][number];
}) {
  return (
    <section className="space-y-3">
      <SectionHeader title="Invoice" />
      <div className="realtor-warm-panel flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4">
        <div>
          <p className="text-sm font-semibold text-realtor-text">
            {booking.quickbooks_invoice_number
              ? `Invoice #${booking.quickbooks_invoice_number}`
              : "Invoice"}
          </p>
          <p className="mt-1 text-xs text-realtor-muted">
            {booking.quickbooks_invoice_total_cents != null
              ? `${formatCurrency(booking.quickbooks_invoice_total_cents)} · `
              : ""}
            {booking.quickbooks_invoice_status ?? "Ready"}
          </p>
        </div>
        <a
          href={booking.quickbooks_invoice_url as string}
          target="_blank"
          rel="noopener"
          className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-realtor-primary-light"
        >
          Open invoice
        </a>
      </div>
    </section>
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

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
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
        <h2 className="text-sm font-semibold uppercase tracking-wider text-realtor-primary">
          {title}
        </h2>
        {source ? (
          <p className="text-[10px] uppercase tracking-wider text-realtor-muted">
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
      <p className="rounded-xl border border-dashed border-realtor-primary/15 bg-realtor-surface-muted/75 p-4 text-sm text-realtor-muted">
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
    <div className="realtor-elevated-panel overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-realtor-primary/10 px-4 py-2">
        <p className="text-xs text-realtor-muted">
          via fotello
        </p>
        <div className="flex gap-2">
          <CopyLinkButton url={embedSrc} label="Copy gallery link" />
          <a
            href={embedSrc}
            target="_blank"
            rel="noopener"
            className="rounded-md bg-realtor-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-realtor-primary-light"
          >
            Open ↗
          </a>
        </div>
      </div>
      <div className="bg-realtor-text">
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
    <div className="realtor-elevated-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-realtor-text">{label}</p>
        <p className="mt-0.5 truncate text-xs text-realtor-muted">
          {deliverable.url}
        </p>
      </div>
      <div className="flex gap-2">
        <CopyLinkButton url={deliverable.url} />
        <a
          href={deliverable.url}
          target="_blank"
          rel="noopener"
          className="rounded-md bg-realtor-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-realtor-primary-light"
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

function buildSimilarBookingHref(
  property: PropertyRow,
  booking: PropertyRow["bookings"][number] | null,
): string {
  const params = new URLSearchParams();
  params.set("repeat", "1");
  params.set("from_property", property.id);
  if (booking?.services.length) params.set("services", booking.services.join(","));
  if (booking?.add_ons.length) params.set("add_ons", booking.add_ons.join(","));
  params.set("street_address", property.street_address);
  if (property.city) params.set("city", property.city);
  if (property.postal_code) params.set("postal_code", property.postal_code);
  if (booking?.square_footage) {
    params.set("square_footage", String(booking.square_footage));
  }
  return `/portal/book?${params.toString()}`;
}
