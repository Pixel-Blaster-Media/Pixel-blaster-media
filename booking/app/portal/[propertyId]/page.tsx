import Link from "next/link";
import { notFound } from "next/navigation";

import {
  BOOKING_STATUSES,
  deliverableTypeLabel,
} from "@/lib/booking/booking-status";
import {
  imageUrlOrNull,
  metadataImageUrls,
  uniqueImageUrls,
} from "@/lib/booking/media-images";
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
import {
  isIGuidePhotoZipUrl,
  type IGuidePhotoZipKind,
} from "@/lib/integrations/iguide/photo-downloads";
import { getServerSupabase } from "@/lib/supabase/server";
import type {
  BookingStatus,
  DeliverableSource,
  DeliverableType,
  Json,
  ListingWebsiteTemplate,
} from "@/lib/supabase/database.types";

import CopyLinkButton from "./CopyLinkButton";
import ListingWebsiteEditor from "./ListingWebsiteEditor";

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

interface ListingWebsiteRow {
  template: ListingWebsiteTemplate;
  slug: string;
  headline: string | null;
  description: string | null;
  feature_bullets: string[];
  included_sections: string[];
  gallery_image_urls: string[] | null;
  hero_image_url: string | null;
  agent_name: string | null;
  agent_email: string | null;
  agent_phone: string | null;
  brokerage_name: string | null;
  cta_text: string | null;
  cta_url: string | null;
  is_published: boolean;
}

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ booked?: string; tab?: string }>;
}) {
  const { propertyId } = await params;
  const query = await searchParams;
  const activeTab = query.tab === "website" ? "website" : "media";
  const user = await requireUser(`/portal/${propertyId}`);
  const supabase = await getServerSupabase();

  // RLS will ensure the row is only returned if the caller owns it (or
  // is admin). .maybeSingle() so a non-owner just gets 404, not 500.
  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, street_address, city, postal_code, owner_id, bookings(id, status, scheduled_at, services, add_ons, square_footage, created_at, quickbooks_invoice_number, quickbooks_invoice_url, quickbooks_invoice_status, quickbooks_invoice_total_cents)",
    )
    .eq("id", propertyId)
    .eq("organization_id", user.organizationId)
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

  const { data: listingWebsite } = await supabase
    .from("listing_websites")
    .select(
      "template, slug, is_published, headline, description, feature_bullets, included_sections, gallery_image_urls, hero_image_url, agent_name, agent_email, agent_phone, brokerage_name, cta_text, cta_url",
    )
    .eq("property_id", property.id)
    .maybeSingle<ListingWebsiteRow>();

  const readyDeliverables = (deliverables ?? []).filter(
    (d) => d.ready_at,
  );
  const realtorVisibleDeliverables = readyDeliverables.filter(
    (d) => d.source !== "fotello",
  );
  const tour = realtorVisibleDeliverables.find(
    (d) => d.type === "virtual_tour",
  );
  const floorPlan = realtorVisibleDeliverables.find((d) => d.type === "floor_plan");
  const gallery = realtorVisibleDeliverables.filter(
    (d) => d.type === "photo_gallery" && hasPhotoAsset(d),
  );
  const videos = realtorVisibleDeliverables.filter(
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
  const heroImageOptions = uniqueImageUrls(
    realtorVisibleDeliverables
      .flatMap((deliverable) => [
        ...metadataImageUrls(deliverable.metadata),
        deliverable.thumbnail_url,
        imageUrlOrNull(deliverable.url),
      ])
      .filter((url): url is string => Boolean(url)),
  );
  const defaultHeroImage = heroImageOptions[0] ?? "";
  const bookSimilarHref = buildSimilarBookingHref(property, latestBooking);

  return (
    <div className="realtor-theme space-y-8">
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

      <header className="realtor-elevated-panel overflow-hidden rounded-3xl">
        <div className="grid gap-5 p-4 md:p-5 lg:grid-cols-[220px_minmax(0,1fr)_auto] lg:items-center">
          {defaultHeroImage ? (
            <div className="overflow-hidden rounded-2xl border border-realtor-primary/15 bg-realtor-surface-muted shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={defaultHeroImage}
                alt=""
                className="aspect-[4/3] w-full object-cover"
              />
            </div>
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center rounded-2xl border border-dashed border-realtor-primary/20 bg-realtor-surface-muted/70 text-xs text-realtor-muted">
              Media preview
            </div>
          )}
          <div className="min-w-0 lg:py-2">
            <h1 className="break-words text-3xl font-semibold leading-tight text-realtor-text md:text-4xl">
              {property.street_address}
            </h1>
            <p className="mt-1 text-sm text-realtor-muted">
              {[property.city, property.postal_code].filter(Boolean).join(" ")}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-realtor-muted">
              {latestBooking?.scheduled_at ? (
                <span>{formatDateTime(latestBooking.scheduled_at)}</span>
              ) : (
                <span>Date to be confirmed</span>
              )}
              {statusMeta ? (
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wider ${statusMeta.pill}`}
                >
                  {statusMeta.label}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex lg:justify-end">
            <Link
              href={bookSimilarHref}
              className="rounded-xl border border-realtor-primary/15 bg-realtor-surface px-4 py-2 text-sm font-semibold text-realtor-text transition hover:border-realtor-primary/35 hover:bg-realtor-surface-muted"
            >
              Book similar shoot
            </Link>
          </div>
        </div>
        <PortalTabs propertyId={property.id} activeTab={activeTab} />
      </header>

      <main className="space-y-8">
        {activeTab === "website" ? (
          <ListingWebsiteEditor
            propertyId={property.id}
            initial={listingWebsite ?? null}
            defaults={{
              slug: buildListingSlug(property.street_address, property.city ?? ""),
              headline: `${property.street_address}${property.city ? `, ${property.city}` : ""}`,
              agentName: user.fullName ?? "",
              agentEmail: user.email,
              heroImageUrl: defaultHeroImage,
              heroImageOptions,
              publicBaseUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
            }}
          />
        ) : (
          <>
            <PhotoDownloadsSection gallery={gallery} />

            {videos.length > 0 ? (
              <VideoSection
                downloads={videoDownloads}
                streamingLinks={videoStreamingLinks}
              />
            ) : null}

            {iGuideAlias || floorPlan ? (
              <FloorPlanDownloadsSection
                alias={iGuideAlias}
                floorPlan={floorPlan ?? null}
                reso={iGuideReso}
              />
            ) : null}

            {iGuideAlias ? (
              <IGuideToolsSection alias={iGuideAlias} />
            ) : null}

            {latestBooking?.quickbooks_invoice_url ? (
              <InvoiceCard booking={latestBooking} />
            ) : null}

            {tour ? (
              <VirtualTourSection alias={iGuideAlias} tour={tour} />
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

interface QuickAction {
  label: string;
  detail: string;
  href: string;
  download?: boolean;
}

function PortalTabs({
  propertyId,
  activeTab,
}: {
  propertyId: string;
  activeTab: "media" | "website";
}) {
  const tabs: Array<{
    id: "media" | "website";
    label: string;
    href: string;
  }> = [
    {
      id: "media",
      label: "Downloads & media",
      href: `/portal/${propertyId}?tab=media`,
    },
    {
      id: "website",
      label: "Custom listing page",
      href: `/portal/${propertyId}?tab=website`,
    },
  ];

  return (
    <nav
      aria-label="Listing workspace"
      className="grid gap-2 border-t border-realtor-primary/15 bg-realtor-surface-muted/55 p-2 sm:grid-cols-2"
    >
      {tabs.map((tab) => {
        const selected = tab.id === activeTab;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={`rounded-xl border px-4 py-3 transition ${
              selected
                ? "border-realtor-primary bg-realtor-primary text-white shadow-sm shadow-realtor-primary/20"
                : "border-realtor-primary/20 bg-realtor-surface/80 text-realtor-text shadow-sm shadow-realtor-primary/5 hover:border-realtor-primary/45 hover:bg-realtor-surface hover:shadow-realtor-primary/10"
            }`}
          >
            <span className="block text-center text-sm font-semibold">
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function buildQuickActions({
  gallery,
  tour,
  floorPlan,
  videos,
  invoiceUrl,
  listingWebsite,
}: {
  gallery: DeliverableRow[];
  tour: DeliverableRow | undefined;
  floorPlan: DeliverableRow | undefined;
  videos: DeliverableRow[];
  invoiceUrl: string | null;
  listingWebsite: ListingWebsiteRow | null;
}): QuickAction[] {
  const actions: QuickAction[] = [];
  if (listingWebsite) {
    actions.push({
      label: "Open custom listing page",
      detail: listingWebsite.headline ?? "Public marketing page",
      href: `/listings/${listingWebsite.slug}`,
    });
  }
  const photo = gallery[0];
  if (photo) {
    actions.push({
      label: "Photos",
      detail: photoDownloadDetail(photo),
      href: "#photos",
    });
  }
  if (tour) {
    actions.push({
      label: "Open virtual tour",
      detail: "Branded tour link",
      href: tour.url,
    });
  }
  if (floorPlan) {
    actions.push({
      label: "Download floor plan",
      detail: "PDF floor plan",
      href: iGuideDownloadUrl(floorPlan.url),
      download: true,
    });
  }
  if (videos[0]) {
    actions.push({
      label: "Open video",
      detail: videos.length > 1 ? `${videos.length} video links` : "Video link",
      href: videos[0].url,
      download: !isStreamingVideoUrl(videos[0].url),
    });
  }
  if (invoiceUrl) {
    actions.push({
      label: "Open invoice",
      detail: "Billing link",
      href: invoiceUrl,
    });
  }
  return actions;
}

function QuickActionGrid({ actions }: { actions: QuickAction[] }) {
  return (
    <section className="realtor-elevated-panel rounded-2xl p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-realtor-primary">
            Ready now
          </p>
          <h2 className="mt-1 text-xl font-semibold text-realtor-text">
            Grab the media you need
          </h2>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {actions.map((action) => (
          <a
            key={`${action.label}:${action.href}`}
            href={action.href}
            target="_blank"
            rel="noopener"
            download={action.download}
            className="group rounded-2xl border border-realtor-primary/15 bg-realtor-surface-muted/70 p-4 transition hover:border-realtor-primary/40 hover:bg-realtor-surface"
          >
            <span className="block text-sm font-semibold text-realtor-text group-hover:text-realtor-primary">
              {action.label} →
            </span>
            <span className="mt-1 block text-xs text-realtor-muted">
              {action.detail}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

function MediaSection({
  id,
  title,
  source,
  description,
  icon,
  children,
}: {
  id?: string;
  title: string;
  source?: string;
  description: string;
  countLabel?: string;
  icon: MediaIconKind;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="realtor-elevated-panel scroll-mt-6 rounded-2xl p-4 md:p-5"
    >
      <div className="space-y-4">
        <div className="flex min-w-0 items-start gap-3">
          <MediaIcon kind={icon} />
          <div className="min-w-0 pt-0.5">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-realtor-text">
                {title}
              </h2>
              {source ? (
                <span className="text-[10px] uppercase tracking-wider text-realtor-muted">
                  via {formatSourceLabel(source)}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-realtor-muted">{description}</p>
          </div>
        </div>
        <div className="grid gap-2">{children}</div>
      </div>
    </section>
  );
}

type MediaIconKind = "photos" | "floor" | "video" | "tools" | "tour";

function MediaIcon({ kind }: { kind: MediaIconKind }) {
  const common = "h-5 w-5";
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-realtor-primary/10 text-realtor-primary ring-1 ring-realtor-primary/10">
      {kind === "photos" ? (
        <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="m7 16 4-4 3 3 2-2 3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="15.5" cy="9.5" r="1.4" fill="currentColor" />
        </svg>
      ) : kind === "floor" ? (
        <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 5h6v6H5zM13 5h6v14h-6zM5 13h6v6H5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      ) : kind === "video" ? (
        <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="m16 10 4-2v8l-4-2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      ) : kind === "tour" ? (
        <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      ) : (
        <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 7h10M5 7h.01M9 12h10M5 12h.01M9 17h10M5 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </span>
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

function PhotoDownloadsSection({ gallery }: { gallery: DeliverableRow[] }) {
  const mlsZipUrl = findPhotoDownloadUrl(gallery, "mls");
  const highResZipUrl = findPhotoDownloadUrl(gallery, "high_res");
  const hasAnyDownload = Boolean(mlsZipUrl || highResZipUrl);

  return (
    <MediaSection
      id="photos"
      title="Photos"
      description="MLS and high-resolution photo downloads."
      icon="photos"
    >
      <PhotoDownloadCard title="MLS photos" url={mlsZipUrl} />
      <PhotoDownloadCard
        title="High-res photos"
        url={highResZipUrl}
        missingLabel="Waiting for the high-res ZIP."
      />
      {!hasAnyDownload ? (
        <p className="rounded-xl border border-dashed border-realtor-primary/20 bg-realtor-surface-muted/70 px-4 py-3 text-xs leading-relaxed text-realtor-muted">
          Photo downloads will appear here as soon as iGUIDE sends them.
        </p>
      ) : null}
    </MediaSection>
  );
}

function PhotoDownloadCard({
  title,
  url,
  missingLabel = "Waiting for the MLS ZIP.",
}: {
  title: string;
  url: string | null;
  missingLabel?: string;
}) {
  return (
    <div className="grid min-w-0 gap-3 rounded-xl border border-realtor-primary/15 bg-realtor-surface-muted/75 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <h4 className="truncate text-xs font-semibold text-realtor-text">{title}</h4>
      {url ? (
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          <a
            href={iGuideDownloadUrl(url)}
            target="_blank"
            rel="noopener"
            download
            className="rounded-md bg-realtor-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-realtor-primary-light"
          >
            Download
          </a>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-realtor-primary/15 px-3 py-2 text-xs text-realtor-muted sm:text-right">
          {missingLabel}
        </p>
      )}
    </div>
  );
}

function FloorPlanDownloadsSection({
  alias,
  floorPlan,
  reso,
}: {
  alias: string | null;
  floorPlan: DeliverableRow | null;
  reso: IGuideRESOResponse | null;
}) {
  const pdfImperial =
    metadataString(floorPlan?.metadata, "pdf_imperial") ??
    (floorPlan?.url.includes("floorplan_imperial") ? floorPlan.url : null) ??
    (alias ? iguideFloorplanPdfUrl(alias) : null);
  const pdfMetric =
    metadataString(floorPlan?.metadata, "pdf_metric") ??
    (floorPlan?.url.includes("floorplan_metric") ? floorPlan.url : null) ??
    (alias ? iguideFloorplanMetricPdfUrl(alias) : null);
  const downloadLinks = [
    { label: "Floor plan PDF (feet)", url: pdfImperial },
    { label: "Floor plan PDF (meters)", url: pdfMetric },
    ...(alias
      ? [
          {
            label: "Property overview PDF (feet)",
            url: `https://youriguide.com/${alias}/doc/branded_property_overview_imperial.pdf`,
          },
          {
            label: "Property overview PDF (meters)",
            url: `https://youriguide.com/${alias}/doc/branded_property_overview_metric.pdf`,
          },
        ]
      : []),
  ].filter((link): link is { label: string; url: string } => Boolean(link.url));

  const areaRows = floorAreaRows(reso);

  return (
    <section className="space-y-4">
      <MediaSection
        title="Floor plans"
        source="iguide"
        description="Floor plans and property overview PDFs for listing paperwork."
        countLabel={`${downloadLinks.length} files`}
        icon="floor"
      >
        {downloadLinks.map((link) => (
          <LinkRow
            key={link.label}
            label={link.label}
            url={link.url}
            actionLabel="Download"
            compact
            download
            proxyDownload
          />
        ))}
      </MediaSection>

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

function IGuideToolsSection({ alias }: { alias: string }) {
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
  return (
    <MediaSection
      title="Tools"
      source="iguide"
      description="Additional iGUIDE tools for feature sheets, embeds, and virtual showings."
      countLabel={`${tools.length} tools`}
      icon="tools"
    >
      <div className="grid gap-2 md:grid-cols-3">
        {tools.map((tool) => (
          <ToolLink key={tool.label} label={tool.label} url={tool.url} />
        ))}
      </div>
    </MediaSection>
  );
}

function VirtualTourSection({
  alias,
  tour,
}: {
  alias: string | null;
  tour: DeliverableRow;
}) {
  const brandedUrl =
    metadataString(tour.metadata, "branded_url") ??
    (alias ? iguideViewerUrl(alias) : tour.url);
  const unbrandedUrl =
    metadataString(tour.metadata, "unbranded_url") ??
    (alias ? iguideUnbrandedUrl(alias) : null);
  const tourLinks = [
    { label: "Branded tour", url: brandedUrl },
    ...(unbrandedUrl ? [{ label: "Unbranded tour", url: unbrandedUrl }] : []),
  ];
  return (
    <section className="space-y-4">
      <MediaSection
        title="Virtual tour"
        source={tour.source}
        description="Branded and unbranded iGUIDE tour links."
        countLabel={`${tourLinks.length} links`}
        icon="tour"
      >
        <div className="grid gap-2 md:grid-cols-2">
          {tourLinks.map((link) => (
            <LinkRow key={link.label} label={link.label} url={link.url} compact />
          ))}
        </div>
      </MediaSection>
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
  );
}

function LinkRow({
  label,
  url,
  compact = false,
  actionLabel = "Open ↗",
  download = false,
  proxyDownload = false,
}: {
  label: string;
  url: string;
  compact?: boolean;
  actionLabel?: string;
  download?: boolean;
  proxyDownload?: boolean;
}) {
  const href = proxyDownload ? iGuideDownloadUrl(url) : url;
  return (
    <div className="grid min-w-0 gap-3 rounded-xl border border-realtor-primary/15 bg-realtor-surface-muted/70 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
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
          download={download || proxyDownload}
          className="rounded-md bg-realtor-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-realtor-primary-light"
        >
          {actionLabel}
        </a>
      </div>
    </div>
  );
}

function ToolLink({ label, url }: { label: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener"
      className="group rounded-xl border border-realtor-primary/15 bg-realtor-surface-muted/70 px-4 py-3 transition hover:border-realtor-primary/30 hover:bg-realtor-surface"
    >
      <span className="block truncate text-xs font-semibold text-realtor-text">
        {label}
      </span>
      <span className="mt-2 inline-flex text-xs font-semibold text-realtor-primary group-hover:text-realtor-primary-dark">
        Open ↗
      </span>
    </a>
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
  const videoRows = [
    ...downloads.map((video) => ({
      video,
      label:
        metadataString(video.metadata, "delivery_label") ??
        deliverableTypeLabel(video.type),
      actionLabel: "Download",
      download: true,
    })),
    ...streamingLinks.map((video) => ({
      video,
      label:
        metadataString(video.metadata, "delivery_label") ??
        deliverableTypeLabel(video.type),
      actionLabel: "Open video ↗",
      download: false,
    })),
  ];

  return (
    <MediaSection
      title="Video"
      description="Video files and viewing links for sharing, MLS, and social."
      countLabel={`${videoRows.length} links`}
      icon="video"
    >
      {videoRows.map(({ video, label, actionLabel, download }) => (
        <LinkRow
          key={video.id}
          label={label}
          url={video.url}
          actionLabel={actionLabel}
          download={download}
          compact
        />
      ))}
    </MediaSection>
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

function formatSourceLabel(source: string): string {
  if (source.toLowerCase() === "iguide") return "iGUIDE";
  return source;
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
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-realtor-primary">
          {title}
        </h2>
        {source ? (
          <p className="text-[10px] uppercase tracking-wider text-realtor-muted">
            via {formatSourceLabel(source)}
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

function IGuideGallery({ deliverable }: { deliverable: DeliverableRow }) {
  const imageUrls = metadataImageUrls(deliverable.metadata);
  const mlsZipUrl = photoDownloadUrl(deliverable.metadata, "mls_photo_zip_url");
  const highResZipUrl = photoDownloadUrl(
    deliverable.metadata,
    "high_res_photo_zip_url",
  );
  const label =
    metadataString(deliverable.metadata, "delivery_label") ?? "Photo gallery";
  if (imageUrls.length > 0) {
    return (
      <div className="realtor-elevated-panel rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-realtor-text">{label}</p>
            <p className="mt-0.5 text-xs text-realtor-muted">
              {imageUrls.length} iGUIDE gallery photos
            </p>
          </div>
          <PhotoDownloadButtons mlsZipUrl={mlsZipUrl} highResZipUrl={highResZipUrl} />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {imageUrls.slice(0, 24).map((url, index) => (
            <a key={url} href={url} target="_blank" rel="noopener">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Listing photo ${index + 1}`}
                className="aspect-[4/3] w-full rounded-2xl object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      </div>
    );
  }
  if (!mlsZipUrl && !highResZipUrl) {
    return (
      <div className="realtor-elevated-panel rounded-2xl p-4">
        <p className="text-sm font-semibold text-realtor-text">{label}</p>
        <p className="mt-1 text-xs text-realtor-muted">
          Photo downloads are still being prepared for this iGUIDE.
        </p>
      </div>
    );
  }
  return (
    <div className="realtor-elevated-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-realtor-text">{label}</p>
        <p className="mt-0.5 truncate text-xs text-realtor-muted">
          iGUIDE photo downloads
        </p>
      </div>
      <div className="flex gap-2">
        <PhotoDownloadButtons mlsZipUrl={mlsZipUrl} highResZipUrl={highResZipUrl} />
      </div>
    </div>
  );
}

function hasPhotoAsset(deliverable: DeliverableRow): boolean {
  return (
    metadataImageUrls(deliverable.metadata).length > 0 ||
    Boolean(photoDownloadUrl(deliverable.metadata, "mls_photo_zip_url")) ||
    Boolean(photoDownloadUrl(deliverable.metadata, "high_res_photo_zip_url"))
  );
}

function photoDownloadDetail(deliverable: DeliverableRow): string {
  if (photoDownloadUrl(deliverable.metadata, "mls_photo_zip_url")) {
    return "MLS download available";
  }
  if (photoDownloadUrl(deliverable.metadata, "high_res_photo_zip_url")) {
    return "High-res download available";
  }
  const count = metadataImageUrls(deliverable.metadata).length;
  return count > 1 ? `${count} iGUIDE gallery photos` : "iGUIDE gallery photo";
}

function PhotoDownloadButtons({
  mlsZipUrl,
  highResZipUrl,
}: {
  mlsZipUrl: string | null;
  highResZipUrl: string | null;
}) {
  if (!mlsZipUrl && !highResZipUrl) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {mlsZipUrl ? (
        <a
          href={iGuideDownloadUrl(mlsZipUrl)}
          target="_blank"
          rel="noopener"
          download
          className="rounded-md bg-realtor-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-realtor-primary-light"
        >
          Download MLS photos
        </a>
      ) : null}
      {highResZipUrl ? (
        <a
          href={iGuideDownloadUrl(highResZipUrl)}
          target="_blank"
          rel="noopener"
          download
          className="rounded-md border border-realtor-primary/20 px-3 py-1.5 text-xs font-semibold text-realtor-text hover:border-realtor-primary/40"
        >
          Download high-res
        </a>
      ) : null}
    </div>
  );
}

function findPhotoDownloadUrl(
  deliverables: DeliverableRow[],
  kind: IGuidePhotoZipKind,
): string | null {
  const metadataKey =
    kind === "mls" ? "mls_photo_zip_url" : "high_res_photo_zip_url";

  for (const deliverable of deliverables) {
    const fromMetadata = photoDownloadUrl(deliverable.metadata, metadataKey, kind);
    if (fromMetadata) return fromMetadata;

    const fromUrl = photoDownloadUrlFromString(deliverable.url, kind);
    if (fromUrl) return fromUrl;
  }

  return null;
}

function photoDownloadUrl(
  metadata: Json | null | undefined,
  key: string,
  kind: IGuidePhotoZipKind = key === "mls_photo_zip_url" ? "mls" : "high_res",
): string | null {
  const url = metadataString(metadata, key);
  return photoDownloadUrlFromString(url, kind);
}

function photoDownloadUrlFromString(
  url: string | null,
  kind?: IGuidePhotoZipKind,
): string | null {
  return isIGuidePhotoZipUrl(url, kind) ? url : null;
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

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function buildListingSlug(address: string, city: string): string {
  return [address, city]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
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
  const qs = params.toString();
  return qs ? `/portal/book?${qs}` : "/portal/book";
}
