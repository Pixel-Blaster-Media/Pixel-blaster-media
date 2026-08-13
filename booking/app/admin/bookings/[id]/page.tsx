import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import {
  BOOKING_STATUSES,
  isCancellable,
  nextBookingStatuses,
} from "@/lib/booking/booking-status";
import {
  buildDeliveryLinks,
  metadataString,
  type DeliveryLink,
  type DeliveryLinkCategory,
} from "@/lib/booking/delivery-links";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  imageUrlOrNull,
  metadataImageUrls,
  uniqueImageUrls,
} from "@/lib/booking/media-images";
import {
  parseRealtorAIMemory,
  summarizeRealtorAIMemory,
} from "@/lib/realtors/memory";
import { getActiveCatalog, type Catalog } from "@/lib/booking/catalog";
import { labelForAddOn, labelForService } from "@/lib/booking/services";
import {
  isIGuidePhotoZipUrl,
  type IGuidePhotoZipKind,
} from "@/lib/integrations/iguide/photo-downloads";
import { hasPortalCredentials } from "@/lib/integrations/iguide/portal-client";
import { listBookingAutoenhanceBatches } from "@/lib/integrations/autoenhance/workflow";
import { isPhotoEditingProviderEnabled } from "@/lib/integrations/provider-enablement";
import { getAutoHDRRuntimeReadiness } from "@/lib/integrations/autohdr/readiness";
import { listBookingAutoHDRJobs } from "@/lib/integrations/autohdr/workflow";
import {
  getServerSupabase,
  getServiceSupabase,
} from "@/lib/supabase/server";
import type {
  BookingStatus,
  DeliverableSource,
  DeliverableType,
  Json,
  ListingWebsiteTemplate,
} from "@/lib/supabase/database.types";

import CancelBookingButton from "../CancelBookingButton";
import BookingActions, {
  DeliveryEmailPanel,
  ManualLinksPanel,
} from "./BookingActions";
import BookingWorkspaceTabs, {
  type WorkspaceTabId,
} from "./BookingWorkspaceTabs";
import AutoenhanceSection from "./AutoenhanceSection";
import AutoHDRSection from "./AutoHDRSection";
import EditBookingForm, {
  type EditableBookingInitial,
  type EditCatalogItem,
} from "./EditBookingForm";
import IGuideSection from "./IGuideSection";
import InvoiceSection from "./InvoiceSection";
import ListingWebsiteSection from "./ListingWebsiteSection";
import MediaWorkflow from "./MediaWorkflow";
import RescheduleBookingForm from "./RescheduleBookingForm";
import VideoLinksSection from "./VideoLinksSection";

export const dynamic = "force-dynamic";

interface BookingDetail {
  id: string;
  status: BookingStatus;
  scheduled_at: string | null;
  scheduled_ends_at: string | null;
  services: string[];
  add_ons: string[];
  square_footage: number | null;
  unit_number: string | null;
  is_vacant: "vacant" | "occupied" | "partial" | null;
  include_basement: boolean | null;
  client_notes: string | null;
  internal_notes: string | null;
  iguide_id: string | null;
  iguide_portal_id: string | null;
  quickbooks_invoice_id: string | null;
  quickbooks_invoice_number: string | null;
  quickbooks_invoice_url: string | null;
  quickbooks_invoice_status: string | null;
  quickbooks_invoice_total_cents: number | null;
  quickbooks_invoice_synced_at: string | null;
  created_at: string;
  properties: {
    id: string;
    street_address: string;
    city: string | null;
    province: string | null;
    postal_code: string | null;
  } | null;
  profiles: {
    id: string;
    full_name: string | null;
    email: string;
    phone: string | null;
    brokerage: string | null;
    delivery_cc_emails: string[] | null;
    internal_notes: string | null;
    ai_memory: Json | null;
  } | null;
}

interface DeliverableRow {
  id: string;
  type: DeliverableType;
  source: DeliverableSource;
  external_id: string | null;
  url: string;
  thumbnail_url: string | null;
  metadata: Json | null;
  ready_at: string | null;
  created_at: string;
}

interface IGuideJobRow {
  status: string;
  work_order_id: string | null;
  default_view_id: string | null;
  match_source: string;
}

interface BookingNotificationRow {
  sent_at: string;
}

interface ListingWebsiteRow {
  template: ListingWebsiteTemplate;
  slug: string;
  is_published: boolean;
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
}

interface BookingLineItemSelectionRow {
  catalog_item_id: string;
}

export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const activeTabId = parseWorkspaceTab(query.tab);
  const admin = await requireAdmin();
  const supabase = await getServerSupabase();
  const [autoHDREnabled, autoenhanceEnabled] = await Promise.all([
    isPhotoEditingProviderEnabled("autohdr", admin.organizationId),
    isPhotoEditingProviderEnabled("autoenhance", admin.organizationId),
  ]);
  const autoHDRReadiness = autoHDREnabled
    ? await getAutoHDRRuntimeReadiness(admin.organizationId)
    : { ready: false, prerequisites: ["Enable AutoHDR"] };

  const [
    { data: booking, error: bookErr },
    { data: deliverables },
    { data: iguideJob },
    { data: listingWebsite },
    { data: bookingLineItems },
    autoenhanceBatches,
    autoHDRJobs,
    catalog,
  ] =
    await Promise.all([
      supabase
        .from("bookings")
        .select(
          "id, status, scheduled_at, scheduled_ends_at, services, add_ons, square_footage, unit_number, is_vacant, include_basement, client_notes, internal_notes, iguide_id, iguide_portal_id, quickbooks_invoice_id, quickbooks_invoice_number, quickbooks_invoice_url, quickbooks_invoice_status, quickbooks_invoice_total_cents, quickbooks_invoice_synced_at, created_at, properties(id, street_address, city, province, postal_code), profiles(id, full_name, email, phone, brokerage, delivery_cc_emails, internal_notes, ai_memory)",
        )
        .eq("id", id)
        .eq("organization_id", admin.organizationId)
        .single<BookingDetail>(),
      supabase
        .from("deliverables")
        .select(
          "id, type, source, external_id, url, thumbnail_url, metadata, ready_at, created_at",
        )
        .eq("booking_id", id)
        .order("created_at", { ascending: false })
        .returns<DeliverableRow[]>(),
      supabase
        .from("iguide_jobs")
        .select("status, work_order_id, default_view_id, match_source")
        .eq("booking_id", id)
        .eq("organization_id", admin.organizationId)
        .maybeSingle<IGuideJobRow>(),
      supabase
        .from("listing_websites")
        .select(
          "template, slug, is_published, headline, description, feature_bullets, included_sections, gallery_image_urls, hero_image_url, agent_name, agent_email, agent_phone, brokerage_name, cta_text, cta_url",
        )
        .eq("booking_id", id)
        .maybeSingle<ListingWebsiteRow>(),
      supabase
        .from("booking_line_items")
        .select("catalog_item_id")
        .eq("booking_id", id)
        .returns<BookingLineItemSelectionRow[]>(),
      autoenhanceEnabled
        ? listBookingAutoenhanceBatches({ admin, bookingId: id })
        : Promise.resolve([]),
      autoHDRReadiness.ready
        ? listBookingAutoHDRJobs({ admin, bookingId: id })
        : Promise.resolve([]),
      getActiveCatalog({ organizationId: admin.organizationId }),
    ]);

  if (bookErr || !booking) notFound();

  const service = getServiceSupabase();
  const { data: deliveryNotification } = await service
    .from("booking_notifications")
    .select("sent_at")
    .eq("booking_id", booking.id)
    .eq("kind", "delivery_ready")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle<BookingNotificationRow>();

  const property = booking.properties;
  const profile = booking.profiles;
  const catalogItems = toEditCatalogItems(catalog);
  const selectedCatalogItemIds = selectedCatalogIdsForBooking(
    booking,
    bookingLineItems ?? [],
    catalog,
  );
  const profileMemorySummary = summarizeRealtorAIMemory(
    parseRealtorAIMemory(profile?.ai_memory),
  );
  const meta = BOOKING_STATUSES[booking.status];
  const transitions = nextBookingStatuses(booking.status);
  const visibleDeliverables = (deliverables ?? []).filter(
    (deliverable) => deliverable.source !== "fotello",
  );
  const readyDeliverables = visibleDeliverables.filter((d) => d.ready_at);
  const portalApiConfigured = await hasPortalCredentials({
    organizationId: admin.organizationId,
  });
  const iguidePhotoDownloads = findIGuidePhotoDownloads(visibleDeliverables);
  const deliveryLinks = buildDeliveryLinks(
    readyDeliverables.map((deliverable) => ({
      id: deliverable.id,
      type: deliverable.type,
      source: deliverable.source,
      url: deliverable.url,
      metadata: deliverable.metadata,
    })),
    process.env.NEXT_PUBLIC_APP_URL ?? "",
  );
  const fullAddress = [
    property?.street_address,
    booking.unit_number ? `Unit ${booking.unit_number}` : null,
    property?.city,
    property?.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
  const firstHeroImage =
    visibleDeliverables
      .flatMap((deliverable) => metadataImageUrls(deliverable.metadata))
      .find(Boolean) ??
    visibleDeliverables
      .find((deliverable) => deliverable.thumbnail_url)
      ?.thumbnail_url ??
    visibleDeliverables
      .map((deliverable) => imageUrlOrNull(deliverable.url))
      .find(Boolean) ??
    "";
  const heroImageOptions = uniqueImageUrls(
    visibleDeliverables
      .flatMap((deliverable) => [
        ...metadataImageUrls(deliverable.metadata),
        deliverable.thumbnail_url,
        imageUrlOrNull(deliverable.url),
      ])
      .filter((url): url is string => Boolean(url)),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/admin/bookings"
          className="rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
        >
          ← Bookings
        </Link>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${meta.pill}`}
        >
          {meta.label}
        </span>
      </div>

      <header className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-4 shadow-lg shadow-realtor-text/10 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-realtor-primary">
              Booking workspace
            </p>
            <h1 className="mt-1 text-2xl font-bold text-realtor-text">
              {property?.street_address ?? "—"}
            </h1>
            <p className="mt-1 text-sm text-realtor-muted">
              {[property?.city, property?.postal_code].filter(Boolean).join(" ")}
              {booking.scheduled_at
                ? ` · ${formatDateTime(booking.scheduled_at)}`
                : " · no date set"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/admin/bookings/${booking.id}?tab=delivery`}
              className="tap-target rounded-full bg-realtor-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-realtor-primary/90"
            >
              Send delivery
            </Link>
            {profile?.phone ? (
              <a
                href={`tel:${profile.phone}`}
                className="tap-target rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
              >
                Call realtor
              </a>
            ) : null}
            {profile?.email ? (
              <a
                href={`mailto:${profile.email}`}
                className="tap-target rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
              >
                Email
              </a>
            ) : null}
            {fullAddress ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  fullAddress,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="tap-target rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
              >
                Map
              </a>
            ) : null}
            {isCancellable(booking.status) ? (
              <CancelBookingButton bookingId={booking.id} />
            ) : null}
            <Link
              href={`/admin/bookings/${booking.id}?tab=details#reschedule`}
              className="tap-target rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
            >
              Reschedule
            </Link>
            <Link
              href="/admin/today"
              className="tap-target rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
            >
              Today
            </Link>
          </div>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          <SummaryStat label="Ready links" value={`${readyDeliverables.length}`} />
          <ContactSummary profile={profile} />
          <ServicesSummary
            services={booking.services.map(labelForService)}
            bookingId={booking.id}
            fullAddress={fullAddress}
          />
        </div>
      </header>

      <BookingWorkspaceTabs
        activeTabId={activeTabId}
        baseHref={`/admin/bookings/${booking.id}`}
        media={
          <>
            <SectionIntro
              eyebrow="Media"
              title="Prepare the finished media"
              body="Use the primary source, review the files, and prepare one complete delivery."
            />
            <MediaWorkflow
              autoHDREnabled={autoHDREnabled}
              autoHDRReadiness={autoHDRReadiness}
              autoHDR={
                <AutoHDRSection bookingId={booking.id} initialJobs={autoHDRJobs} />
              }
              autoenhanceEnabled={autoenhanceEnabled}
              hasIGuidePhotos={Boolean(
                iguidePhotoDownloads.mls || iguidePhotoDownloads.highRes,
              )}
              manualUploadEnabled={false}
              iGuide={
                <IGuideSection
                  bookingId={booking.id}
                  initialIGuideId={booking.iguide_id}
                  initialPortalId={booking.iguide_portal_id}
                  portalApiConfigured={portalApiConfigured}
                  job={iguideJob ?? null}
                  initialPhotoDownloads={iguidePhotoDownloads}
                />
              }
              autoenhance={
                <AutoenhanceSection
                  bookingId={booking.id}
                  iguidePortalId={booking.iguide_portal_id}
                  initialBatches={autoenhanceBatches}
                />
              }
              video={<VideoLinksSection bookingId={booking.id} />}
              manualLinks={
                <ManualLinksPanel
                  bookingId={booking.id}
                  deliverables={visibleDeliverables}
                />
              }
            />
          </>
        }
        website={
          <>
            <SectionIntro
              eyebrow="Custom page"
              title="Build the listing page"
              body="Pick a template, choose media, and publish a shareable page."
            />
            <ListingWebsiteSection
              bookingId={booking.id}
              initial={listingWebsite ?? null}
              defaults={{
                slug: buildListingSlug(
                  property?.street_address ?? "listing",
                  property?.city ?? "",
                ),
                headline: property?.street_address
                  ? `${property.street_address}${property.city ? `, ${property.city}` : ""}`
                  : "Featured listing",
                agentName: profile?.full_name ?? "",
                agentEmail: profile?.email ?? "",
                agentPhone: profile?.phone ?? "",
                brokerageName: profile?.brokerage ?? "",
                heroImageUrl: firstHeroImage,
                heroImageOptions,
                publicBaseUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
              }}
            />
          </>
        }
        delivery={
          <>
            <SectionIntro
              eyebrow="Delivery"
              title="Send the media"
              body="Preview links, add extra recipients, and resend the email."
            />
            <DeliveryEmailPanel
              bookingId={booking.id}
              deliveryEmailSentAt={deliveryNotification?.sent_at ?? null}
              primaryRecipientEmail={profile?.email ?? null}
              primaryRecipientName={profile?.full_name ?? null}
              savedCcEmails={profile?.delivery_cc_emails ?? []}
              adminEmail={admin.email}
            />
            {profile?.internal_notes || profileMemorySummary.length ? (
              <AgentNotesReminder
                notes={profile?.internal_notes ?? null}
                memory={profileMemorySummary}
              />
            ) : null}
            <DeliveryLinksPanel links={deliveryLinks} />
          </>
        }
        details={
          <DetailsTab
            booking={booking}
            profile={profile}
            fullAddress={fullAddress}
            transitions={transitions}
            catalogItems={catalogItems}
            selectedCatalogItemIds={selectedCatalogItemIds}
            invoice={
              <InvoiceSection
                bookingId={booking.id}
                initial={{
                  id: booking.quickbooks_invoice_id,
                  number: booking.quickbooks_invoice_number,
                  url: booking.quickbooks_invoice_url,
                  status: booking.quickbooks_invoice_status,
                  totalCents: booking.quickbooks_invoice_total_cents,
                  syncedAt: booking.quickbooks_invoice_synced_at,
                }}
              />
            }
          />
        }
      />
    </div>
  );
}

function parseWorkspaceTab(raw: string | undefined): WorkspaceTabId {
  if (raw === "billing") return "details";
  return raw === "media" ||
    raw === "website" ||
    raw === "delivery" ||
    raw === "details"
    ? raw
    : "media";
}

function DetailsTab({
  booking,
  profile,
  fullAddress,
  transitions,
  catalogItems,
  selectedCatalogItemIds,
  invoice,
}: {
  booking: BookingDetail;
  profile: BookingDetail["profiles"];
  fullAddress: string;
  transitions: BookingStatus[];
  catalogItems: EditCatalogItem[];
  selectedCatalogItemIds: string[];
  invoice: ReactNode;
}) {
  const editableInitial: EditableBookingInitial = {
    scheduledAtLocal: booking.scheduled_at
      ? formatDateTimeLocalInput(booking.scheduled_at)
      : "",
    streetAddress: booking.properties?.street_address ?? "",
    unitNumber: booking.unit_number ?? "",
    city: booking.properties?.city ?? "",
    province: booking.properties?.province ?? "ON",
    postalCode: booking.properties?.postal_code ?? "",
    squareFootage: booking.square_footage ? String(booking.square_footage) : "",
    contactName: profile?.full_name ?? profile?.email ?? "",
    contactEmail: profile?.email ?? "",
    contactPhone: profile?.phone ?? "",
    brokerage: profile?.brokerage ?? "",
    clientNotes: booking.client_notes ?? "",
    internalNotes: booking.internal_notes ?? "",
    selectedCatalogItemIds,
  };

  return (
    <>
      <SectionIntro
        eyebrow="Details"
        title="Edit and reference"
        body="Fix the schedule, address, selected services, realtor info, or notes without leaving this booking."
      />
      <div id="reschedule">
        <RescheduleBookingForm
          bookingId={booking.id}
          initialScheduledAtLocal={editableInitial.scheduledAtLocal}
        />
      </div>
      <details className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-realtor-text">
          Invoice and billing
        </summary>
        <div className="mt-4">{invoice}</div>
      </details>
      <Panel title="Edit booking">
        <EditBookingForm
          bookingId={booking.id}
          initial={editableInitial}
          catalogItems={catalogItems}
        />
      </Panel>
      <BookingActions
        bookingId={booking.id}
        currentStatus={booking.status}
        transitions={transitions}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Realtor profile">
          <Row label="Name" value={profile?.full_name ?? "—"} />
          <Row
            label="Email"
            value={
              profile?.email ? (
                <a
                  href={`mailto:${profile.email}`}
                  className="text-realtor-primary underline"
                >
                  {profile.email}
                </a>
              ) : (
                "—"
              )
            }
          />
          <Row
            label="Phone"
            value={
              profile?.phone ? (
                <a
                  href={`tel:${profile.phone}`}
                  className="text-realtor-primary underline"
                >
                  {profile.phone}
                </a>
              ) : (
                "—"
              )
            }
          />
          <Row label="Brokerage" value={profile?.brokerage ?? "—"} />
          {profile?.internal_notes ? (
            <Note title="Agent notes" body={profile.internal_notes} />
          ) : null}
        </Panel>

        <Panel title="Shoot details">
          <Row
            label="Services"
            value={booking.services.map(labelForService).join(", ") || "—"}
          />
          <Row
            label="Add-ons"
            value={
              booking.add_ons.length
                ? booking.add_ons.map(labelForAddOn).join(", ")
                : "—"
            }
          />
          <Row
            label="Square footage"
            value={booking.square_footage ? `${booking.square_footage}` : "—"}
          />
          <Row label="Unit #" value={booking.unit_number ?? "—"} />
          <Row
            label="Occupancy"
            value={
              booking.is_vacant === "vacant"
                ? "Vacant"
                : booking.is_vacant === "partial"
                  ? "Partially occupied"
                  : booking.is_vacant === "occupied"
                    ? "Occupied"
                    : "—"
            }
          />
          <Row
            label="Basement"
            value={
              booking.include_basement == null
                ? "—"
                : booking.include_basement
                  ? "Include"
                  : "Skip"
            }
          />
          {fullAddress ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                fullAddress,
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl border border-realtor-primary/15 bg-white/65 px-3 py-2 text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/50"
            >
              Open in Google Maps
            </a>
          ) : null}
        </Panel>

        <Panel title="Notes">
          {booking.client_notes || booking.internal_notes ? (
            <>
              {booking.client_notes ? (
                <Note title="Realtor" body={booking.client_notes} />
              ) : null}
              {booking.internal_notes ? (
                <Note title="Internal" body={booking.internal_notes} />
              ) : null}
            </>
          ) : (
            <p className="text-sm text-realtor-muted">No notes on this booking.</p>
          )}
        </Panel>
      </div>
    </>
  );
}

function AgentNotesReminder({
  notes,
  memory,
}: {
  notes: string | null;
  memory: string[];
}) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-lg shadow-realtor-text/10">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">
        Agent notes reminder
      </p>
      {notes ? (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-amber-900">
          {notes}
        </p>
      ) : null}
      {memory.length ? (
        <ul className="mt-2 space-y-1 text-sm leading-6 text-amber-900">
          {memory.slice(0, 4).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function DeliveryLinksPanel({ links }: { links: DeliveryLink[] }) {
  const groups = groupDeliveryLinks(links);
  const totalLinks = groups.reduce((sum, group) => sum + group.links.length, 0);
  return (
    <Panel title="Delivery preview">
      {links.length > 0 ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-realtor-primary/15 bg-white/65 p-3">
            <p className="text-sm font-semibold text-realtor-text">
              {totalLinks} delivery link{totalLinks === 1 ? "" : "s"} ready
            </p>
            <p className="mt-1 text-xs text-realtor-muted">
              These are grouped the same way the realtor sees them in their
              portal media kit and delivery email.
            </p>
          </div>
          {groups.map((group) => (
            <div key={group.category}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-realtor-primary">
                {group.title}
              </p>
              <ul className="mt-1 space-y-1">
                {group.links.map((link) => (
                  <li key={`${link.label}:${link.url}`}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener"
                      className="block truncate text-xs text-realtor-text/90 underline decoration-white/20 hover:text-realtor-primary"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-realtor-muted">
          Delivery links will appear here once video, iGUIDE, or manual links
          are ready.
        </p>
      )}
    </Panel>
  );
}

function groupDeliveryLinks(links: DeliveryLink[]): Array<{
  category: DeliveryLinkCategory;
  title: string;
  links: DeliveryLink[];
}> {
  const titles: Record<DeliveryLinkCategory, string> = {
    photos: "Photos",
    tour: "Virtual tour",
    floor_plans: "Floor plans",
    video: "Video",
    tools: "Tools",
    other: "Other",
  };
  const order: DeliveryLinkCategory[] = [
    "photos",
    "tour",
    "floor_plans",
    "video",
    "tools",
    "other",
  ];
  return order
    .map((category) => ({
      category,
      title: titles[category],
      links: links.filter((link) => link.category === category),
    }))
    .filter((group) => group.links.length > 0);
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-realtor-primary/15 bg-white/65 p-3">
      <p className="text-[10px] uppercase tracking-wider text-realtor-muted">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-realtor-text">{value}</p>
    </div>
  );
}

function ContactSummary({ profile }: { profile: BookingDetail["profiles"] }) {
  return (
    <div className="rounded-2xl border border-realtor-primary/15 bg-white/65 p-3">
      <p className="text-[10px] uppercase tracking-wider text-realtor-muted">
        Realtor
      </p>
      <div className="mt-1 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-realtor-text">
            {profile?.full_name ?? profile?.email ?? "Unknown"}
          </p>
          {profile?.brokerage ? (
            <p className="truncate text-xs text-realtor-muted">
              {profile.brokerage}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {profile?.phone ? (
            <a
              href={`tel:${profile.phone}`}
              className="rounded-full bg-realtor-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-realtor-primary/90"
            >
              Call
            </a>
          ) : null}
          {profile?.email ? (
            <a
              href={`mailto:${profile.email}`}
              className="rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
            >
              Email
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ServicesSummary({
  services,
  bookingId,
  fullAddress,
}: {
  services: string[];
  bookingId: string;
  fullAddress: string;
}) {
  return (
    <div className="rounded-2xl border border-realtor-primary/15 bg-white/65 p-3">
      <p className="text-[10px] uppercase tracking-wider text-realtor-muted">
        Services
      </p>
      <div className="mt-1 flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-semibold text-realtor-text">
          {services.join(", ") || "—"}
        </p>
        <div className="flex shrink-0 gap-1.5">
          {fullAddress ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                fullAddress,
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-realtor-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-realtor-primary/90"
            >
              Map
            </a>
          ) : null}
          <Link
            href={`/admin/bookings/${bookingId}?tab=details`}
            className="rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
          >
            Open
          </Link>
        </div>
      </div>
    </div>
  );
}

function SectionIntro({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.2em] text-realtor-primary">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-xl font-semibold text-realtor-text">{title}</h2>
      <p className="mt-1 text-sm text-realtor-muted">{body}</p>
    </div>
  );
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
        {title}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-realtor-muted">{body}</p>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-4 shadow-lg shadow-realtor-text/10">
      <p className="text-[11px] uppercase tracking-wider text-realtor-primary/80">
        {title}
      </p>
      <div className="mt-3 space-y-2 text-sm">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-2 rounded-xl border border-realtor-primary/10 bg-white/65 px-3 py-2">
      <span className="text-xs text-realtor-muted">{label}</span>
      <span className="text-right text-realtor-text">{value}</span>
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function formatDateTimeLocalInput(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get(
    "minute",
  )}`;
}

function toEditCatalogItems(catalog: Catalog): EditCatalogItem[] {
  return [...catalog.bundles, ...catalog.aLaCarte, ...catalog.addons].map(
    (item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      slug: item.slug,
      durationMinutes: item.duration_minutes,
      priceCents: item.price_cents,
    }),
  );
}

function selectedCatalogIdsForBooking(
  booking: BookingDetail,
  lineItems: BookingLineItemSelectionRow[],
  catalog: Catalog,
): string[] {
  if (lineItems.length > 0) {
    return lineItems.map((line) => line.catalog_item_id);
  }
  const bySlug = new Map(
    [...catalog.bundles, ...catalog.aLaCarte, ...catalog.addons].map((item) => [
      item.slug,
      item.id,
    ]),
  );
  return [...booking.services, ...booking.add_ons]
    .map((slug) => bySlug.get(slug))
    .filter((id): id is string => Boolean(id));
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

function findIGuidePhotoDownloads(deliverables: DeliverableRow[]): {
  mls: string | null;
  highRes: string | null;
} {
  let mls: string | null = null;
  let highRes: string | null = null;

  for (const deliverable of deliverables) {
    if (deliverable.type !== "photo_gallery") continue;
    mls ??=
      iGuidePhotoZipUrl(
        metadataString(deliverable.metadata, "mls_photo_zip_url"),
        "mls",
      ) ?? iGuidePhotoZipUrl(deliverable.url, "mls");
    highRes ??=
      iGuidePhotoZipUrl(
        metadataString(deliverable.metadata, "high_res_photo_zip_url"),
        "high_res",
      ) ?? iGuidePhotoZipUrl(deliverable.url, "high_res");
  }

  return { mls, highRes };
}

function iGuidePhotoZipUrl(
  url: string | null,
  kind: IGuidePhotoZipKind,
): string | null {
  return isIGuidePhotoZipUrl(url, kind) ? url : null;
}
