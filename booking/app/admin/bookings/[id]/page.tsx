import Link from "next/link";
import { notFound } from "next/navigation";

import {
  BOOKING_STATUSES,
  nextBookingStatuses,
} from "@/lib/booking/booking-status";
import {
  buildDeliveryLinks,
  metadataString,
  type DeliveryLink,
  type DeliveryLinkCategory,
} from "@/lib/booking/delivery-links";
import {
  imageUrlOrNull,
  metadataImageUrls,
  uniqueImageUrls,
} from "@/lib/booking/media-images";
import { labelForAddOn, labelForService } from "@/lib/booking/services";
import {
  isIGuidePhotoZipUrl,
  type IGuidePhotoZipKind,
} from "@/lib/integrations/iguide/photo-downloads";
import { hasPortalCredentials } from "@/lib/integrations/iguide/portal-client";
import { getServerSupabase } from "@/lib/supabase/server";
import type {
  BookingStatus,
  DeliverableSource,
  DeliverableType,
  Json,
  ListingWebsiteTemplate,
} from "@/lib/supabase/database.types";

import BookingActions, {
  DeliveryEmailPanel,
  ManualLinksPanel,
} from "./BookingActions";
import BookingWorkspaceTabs, {
  type WorkspaceTabId,
} from "./BookingWorkspaceTabs";
import IGuideSection from "./IGuideSection";
import InvoiceSection from "./InvoiceSection";
import ListingWebsiteSection from "./ListingWebsiteSection";
import VideoLinksSection from "./VideoLinksSection";

export const dynamic = "force-dynamic";

interface BookingDetail {
  id: string;
  status: BookingStatus;
  scheduled_at: string | null;
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
  fotello_listing_id: string | null;
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
    postal_code: string | null;
  } | null;
  profiles: {
    id: string;
    full_name: string | null;
    email: string;
    phone: string | null;
    brokerage: string | null;
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
  const supabase = await getServerSupabase();

  const [
    { data: booking, error: bookErr },
    { data: deliverables },
    { data: iguideJob },
    { data: deliveryNotification },
    { data: listingWebsite },
  ] =
    await Promise.all([
      supabase
        .from("bookings")
        .select(
          "id, status, scheduled_at, services, add_ons, square_footage, unit_number, is_vacant, include_basement, client_notes, internal_notes, iguide_id, iguide_portal_id, fotello_listing_id, quickbooks_invoice_id, quickbooks_invoice_number, quickbooks_invoice_url, quickbooks_invoice_status, quickbooks_invoice_total_cents, quickbooks_invoice_synced_at, created_at, properties(id, street_address, city, postal_code), profiles(id, full_name, email, phone, brokerage)",
        )
        .eq("id", id)
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
        .maybeSingle<IGuideJobRow>(),
      supabase
        .from("booking_notifications")
        .select("sent_at")
        .eq("booking_id", id)
        .eq("kind", "delivery_ready")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle<BookingNotificationRow>(),
      supabase
        .from("listing_websites")
        .select(
          "template, slug, is_published, headline, description, feature_bullets, included_sections, gallery_image_urls, hero_image_url, agent_name, agent_email, agent_phone, brokerage_name, cta_text, cta_url",
        )
        .eq("booking_id", id)
        .maybeSingle<ListingWebsiteRow>(),
    ]);

  if (bookErr || !booking) notFound();

  const property = booking.properties;
  const profile = booking.profiles;
  const meta = BOOKING_STATUSES[booking.status];
  const transitions = nextBookingStatuses(booking.status);
  const readyDeliverables = (deliverables ?? []).filter((d) => d.ready_at);
  const portalApiConfigured = await hasPortalCredentials();
  const iguidePhotoDownloads = findIGuidePhotoDownloads(deliverables ?? []);
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
    (deliverables ?? [])
      .filter((deliverable) => deliverable.source !== "fotello")
      .flatMap((deliverable) => metadataImageUrls(deliverable.metadata))
      .find(Boolean) ??
    (deliverables ?? [])
      .filter((deliverable) => deliverable.source !== "fotello")
      .find((deliverable) => deliverable.thumbnail_url)
      ?.thumbnail_url ??
    (deliverables ?? [])
      .filter((deliverable) => deliverable.source !== "fotello")
      .map((deliverable) => imageUrlOrNull(deliverable.url))
      .find(Boolean) ??
    "";
  const heroImageOptions = uniqueImageUrls(
    (deliverables ?? [])
      .filter((deliverable) => deliverable.source !== "fotello")
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
          className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-ink-muted transition hover:border-white/30 hover:text-white"
        >
          ← Bookings
        </Link>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${meta.pill}`}
        >
          {meta.label}
        </span>
      </div>

      <header className="rounded-2xl border border-white/10 bg-ink-soft/60 p-4 shadow-lg shadow-black/10 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
              Booking workspace
            </p>
            <h1 className="mt-1 text-2xl font-bold text-white">
              {property?.street_address ?? "—"}
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              {[property?.city, property?.postal_code].filter(Boolean).join(" ")}
              {booking.scheduled_at
                ? ` · ${formatDateTime(booking.scheduled_at)}`
                : " · no date set"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {profile?.phone ? (
              <a
                href={`tel:${profile.phone}`}
                className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-light"
              >
                Call realtor
              </a>
            ) : null}
            {profile?.email ? (
              <a
                href={`mailto:${profile.email}`}
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white transition hover:border-brand-light"
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
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white transition hover:border-brand-light"
              >
                Map
              </a>
            ) : null}
            <Link
              href="/admin/today"
              className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white transition hover:border-brand-light"
            >
              Today
            </Link>
          </div>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          <SummaryStat label="Ready links" value={`${readyDeliverables.length}`} />
          <SummaryStat
            label="Realtor"
            value={profile?.full_name ?? profile?.email ?? "Unknown"}
          />
          <SummaryStat
            label="Services"
            value={booking.services.map(labelForService).join(", ") || "—"}
          />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <main>
          <BookingWorkspaceTabs
            activeTabId={activeTabId}
            baseHref={`/admin/bookings/${booking.id}`}
            overview={
              <>
                <SectionIntro
                  eyebrow="Overview"
                  title="What needs to happen next?"
                  body="Use this area for the core job state: confirm, move forward, or cancel the booking."
                />
                <BookingActions
                  bookingId={booking.id}
                  currentStatus={booking.status}
                  transitions={transitions}
                />
              </>
            }
            media={
              <>
                <SectionIntro
                  eyebrow="Media"
                  title="Upload and sync deliverables"
                  body="Use iGUIDE for tours, floor plans, and gallery photos. Add video links for YouTube, Drive, Dropbox, or direct video deliveries."
                />
                <VideoLinksSection bookingId={booking.id} />
                <IGuideSection
                  bookingId={booking.id}
                  initialIGuideId={booking.iguide_id}
                  initialPortalId={booking.iguide_portal_id}
                  portalApiConfigured={portalApiConfigured}
                  job={iguideJob ?? null}
                  initialPhotoDownloads={iguidePhotoDownloads}
                />
                <ManualLinksPanel
                  bookingId={booking.id}
                  deliverables={deliverables ?? []}
                />
              </>
            }
            website={
              <>
                <SectionIntro
                  eyebrow="Website"
                  title="Create a public listing launch page"
                  body="Give the agent a polished, shareable website powered by the same media and listing details already attached to this job."
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
                  title="Send the realtor their finished media"
                  body="Preview the grouped links, add extra recipients, and resend the delivery email when agents misplace it."
                />
                <DeliveryEmailPanel
                  bookingId={booking.id}
                  deliveryEmailSentAt={deliveryNotification?.sent_at ?? null}
                />
                <DeliveryLinksPanel links={deliveryLinks} />
              </>
            }
            billing={
              <>
                <SectionIntro
                  eyebrow="Billing"
                  title="Create or check the invoice"
                  body="Keep invoicing separate from media delivery so it is easy to find when the job is ready to bill."
                />
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
              </>
            }
          />
        </main>

        <aside className="space-y-4 lg:sticky lg:top-16 lg:self-start">
          <Panel title="Realtor">
            <Row label="Name" value={profile?.full_name ?? "—"} />
            <Row
              label="Email"
              value={
                profile?.email ? (
                  <a
                    href={`mailto:${profile.email}`}
                    className="text-brand-light underline"
                  >
                    {profile.email}
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <Row label="Phone" value={profile?.phone ?? "—"} />
            <Row label="Brokerage" value={profile?.brokerage ?? "—"} />
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
          </Panel>

          <DeliveryChecklist
            booking={booking}
            links={deliveryLinks}
            readyDeliverables={readyDeliverables}
            deliveryEmailSentAt={deliveryNotification?.sent_at ?? null}
          />

          {booking.client_notes || booking.internal_notes ? (
            <Panel title="Notes">
              {booking.client_notes ? (
                <Note title="Realtor" body={booking.client_notes} />
              ) : null}
              {booking.internal_notes ? (
                <Note title="Internal" body={booking.internal_notes} />
              ) : null}
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function parseWorkspaceTab(raw: string | undefined): WorkspaceTabId {
  return raw === "media" ||
    raw === "website" ||
    raw === "delivery" ||
    raw === "billing"
    ? raw
    : "overview";
}

function DeliveryChecklist({
  booking,
  links,
  readyDeliverables,
  deliveryEmailSentAt,
}: {
  booking: BookingDetail;
  links: DeliveryLink[];
  readyDeliverables: DeliverableRow[];
  deliveryEmailSentAt: string | null;
}) {
  const items = buildDeliveryChecklistItems({
    booking,
    links,
    readyDeliverables,
    deliveryEmailSentAt,
  });
  const missingRequired = items.filter(
    (item) => item.required && item.status === "missing",
  ).length;

  return (
    <Panel title="Delivery checklist">
      <div
        className={`rounded-2xl border p-3 ${
          missingRequired === 0
            ? "border-emerald-400/30 bg-emerald-500/10"
            : "border-amber-400/30 bg-amber-500/10"
        }`}
      >
        <p className="text-sm font-semibold text-white">
          {missingRequired === 0
            ? "Ready to send"
            : `${missingRequired} required item${
                missingRequired === 1 ? "" : "s"
              } missing`}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Use this as a quick final check before sending or resending the
          delivery email.
        </p>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.label}
            className="rounded-2xl border border-white/10 bg-ink/35 p-3"
          >
            <div className="flex items-start gap-2">
              <span
                className={`mt-0.5 grid h-5 w-5 place-items-center rounded-full text-xs font-bold ${
                  item.status === "ready"
                    ? "bg-emerald-400/20 text-emerald-200"
                    : item.status === "missing"
                      ? "bg-amber-400/20 text-amber-100"
                      : "bg-white/10 text-ink-muted"
                }`}
                aria-hidden="true"
              >
                {item.status === "ready"
                  ? "✓"
                  : item.status === "missing"
                    ? "!"
                    : "·"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-white">
                    {item.label}
                  </p>
                  {!item.required ? (
                    <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-muted">
                      Optional
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-ink-muted">{item.detail}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

type ChecklistStatus = "ready" | "missing" | "optional";

interface ChecklistItem {
  label: string;
  detail: string;
  required: boolean;
  status: ChecklistStatus;
}

function buildDeliveryChecklistItems({
  booking,
  links,
  readyDeliverables,
  deliveryEmailSentAt,
}: {
  booking: BookingDetail;
  links: DeliveryLink[];
  readyDeliverables: DeliverableRow[];
  deliveryEmailSentAt: string | null;
}): ChecklistItem[] {
  const expectsPhotos = expectsAny(booking, [
    "residential_photography",
    "blue_print",
    "social_media_special",
    "social_media_plus",
    "ultimate",
  ]);
  const expectsIGuide = expectsAny(booking, [
    "iguide_measurements",
    "blue_print",
    "social_media_special",
    "social_media_plus",
    "ultimate",
  ]);
  const expectsVideo = expectsAny(booking, [
    "social_media_reel",
    "video_tour",
    "social_media_special",
    "social_media_plus",
    "ultimate",
  ]);

  const hasPhotoLink = hasCategory(links, "photos");
  const hasTourLink = hasCategory(links, "tour");
  const hasFloorPlanLink = hasCategory(links, "floor_plans");
  const hasVideoLink = hasCategory(links, "video");
  const hasInvoice =
    Boolean(booking.quickbooks_invoice_id) ||
    Boolean(booking.quickbooks_invoice_url) ||
    Boolean(booking.quickbooks_invoice_number);
  const items: ChecklistItem[] = [
    {
      label: "Photos",
      detail: hasPhotoLink
        ? "Photo delivery link is included."
        : expectsPhotos
          ? "Sync iGUIDE so the gallery photos are included."
          : "No photo package selected.",
      required: expectsPhotos,
      status: hasPhotoLink ? "ready" : expectsPhotos ? "missing" : "optional",
    },
    {
      label: "iGUIDE tour",
      detail: hasTourLink
        ? "Branded/unbranded tour links are included."
        : expectsIGuide
          ? "Add or sync the iGUIDE before sending."
          : "No iGUIDE package selected.",
      required: expectsIGuide,
      status: hasTourLink ? "ready" : expectsIGuide ? "missing" : "optional",
    },
    {
      label: "Floor plans",
      detail: hasFloorPlanLink
        ? "Floor plan and overview PDF links are included."
        : expectsIGuide
          ? "Sync iGUIDE so the floor plans are included."
          : "Only needed when iGUIDE/floor plans were ordered.",
      required: expectsIGuide,
      status: hasFloorPlanLink
        ? "ready"
        : expectsIGuide
          ? "missing"
          : "optional",
    },
    {
      label: "Video",
      detail: hasVideoLink
        ? "Video download or YouTube/streaming link is included."
        : expectsVideo
          ? "Add the video download and/or YouTube link in the Media section."
          : "Optional unless this booking includes video.",
      required: expectsVideo,
      status: hasVideoLink ? "ready" : expectsVideo ? "missing" : "optional",
    },
    {
      label: "Invoice",
      detail: hasInvoice
        ? "QuickBooks invoice has been created."
        : "Create this when you want invoice info attached to the booking.",
      required: false,
      status: hasInvoice ? "ready" : "optional",
    },
    {
      label: "Delivery email",
      detail: deliveryEmailSentAt
        ? `Last sent ${formatDateTime(deliveryEmailSentAt)}.`
        : "Send when the required media above is ready.",
      required: false,
      status: deliveryEmailSentAt ? "ready" : "optional",
    },
  ];

  return items;
}

function expectsAny(booking: BookingDetail, slugs: string[]): boolean {
  const selected = new Set([...booking.services, ...booking.add_ons]);
  return slugs.some((slug) => selected.has(slug));
}

function hasCategory(
  links: DeliveryLink[],
  category: DeliveryLinkCategory,
): boolean {
  return links.some((link) => link.category === category);
}

function DeliveryLinksPanel({ links }: { links: DeliveryLink[] }) {
  const groups = groupDeliveryLinks(links);
  const totalLinks = groups.reduce((sum, group) => sum + group.links.length, 0);
  return (
    <Panel title="Delivery preview">
      {links.length > 0 ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-ink/25 p-3">
            <p className="text-sm font-semibold text-white">
              {totalLinks} delivery link{totalLinks === 1 ? "" : "s"} ready
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              These are grouped the same way the realtor sees them in their
              portal media kit and delivery email.
            </p>
          </div>
          {groups.map((group) => (
            <div key={group.category}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-light">
                {group.title}
              </p>
              <ul className="mt-1 space-y-1">
                {group.links.map((link) => (
                  <li key={`${link.label}:${link.url}`}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener"
                      className="block truncate text-xs text-white/90 underline decoration-white/20 hover:text-brand-light"
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
        <p className="text-sm text-ink-muted">
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
    <div className="rounded-2xl border border-white/10 bg-ink/50 p-3">
      <p className="text-[10px] uppercase tracking-wider text-ink-muted">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-white">{value}</p>
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
      <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-xl font-semibold text-white">{title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{body}</p>
    </div>
  );
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {title}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{body}</p>
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
    <div className="rounded-2xl border border-white/10 bg-ink-soft/55 p-4 shadow-lg shadow-black/10">
      <p className="text-[11px] uppercase tracking-wider text-brand-light/80">
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
    <div className="flex flex-wrap justify-between gap-2 rounded-xl border border-white/5 bg-ink/25 px-3 py-2">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-right text-white">{value}</span>
    </div>
  );
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
