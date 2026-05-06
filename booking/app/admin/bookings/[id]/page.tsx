import Link from "next/link";
import { notFound } from "next/navigation";

import {
  BOOKING_STATUSES,
  deliverableTypeLabel,
  nextBookingStatuses,
} from "@/lib/booking/booking-status";
import { labelForAddOn, labelForService } from "@/lib/booking/services";
import { hasPortalCredentials } from "@/lib/integrations/iguide/portal-client";
import { getServerSupabase } from "@/lib/supabase/server";
import type {
  BookingStatus,
  DeliverableSource,
  DeliverableType,
} from "@/lib/supabase/database.types";

import BookingActions from "./BookingActions";
import FotelloSection from "./FotelloSection";
import IGuideSection from "./IGuideSection";
import InvoiceSection from "./InvoiceSection";

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
  metadata: {
    status?: string;
    shot_type?: string;
    last_synced_at?: string;
  } | null;
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

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getServerSupabase();

  const [
    { data: booking, error: bookErr },
    { data: deliverables },
    { data: iguideJob },
    { data: deliveryNotification },
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
    ]);

  if (bookErr || !booking) notFound();

  const property = booking.properties;
  const profile = booking.profiles;
  const meta = BOOKING_STATUSES[booking.status];
  const transitions = nextBookingStatuses(booking.status);
  const otherDeliverables = (deliverables ?? []).filter(
    (d) => d.source !== "fotello",
  );
  const readyDeliverables = (deliverables ?? []).filter((d) => d.ready_at);
  const fullAddress = [
    property?.street_address,
    booking.unit_number ? `Unit ${booking.unit_number}` : null,
    property?.city,
    property?.postal_code,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/admin/bookings"
          className="text-xs text-ink-muted hover:text-white"
        >
          ← Bookings
        </Link>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${meta.pill}`}
        >
          {meta.label}
        </span>
      </div>

      <header className="rounded-lg border border-white/10 bg-ink-soft/50 p-4">
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
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-light"
              >
                Call realtor
              </a>
            ) : null}
            {profile?.email ? (
              <a
                href={`mailto:${profile.email}`}
                className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white hover:border-brand-light"
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
                className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white hover:border-brand-light"
              >
                Map
              </a>
            ) : null}
            <Link
              href="/admin/today"
              className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white hover:border-brand-light"
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
        <main className="space-y-6">
          <BookingActions
            bookingId={booking.id}
            currentStatus={booking.status}
            transitions={transitions}
            deliverables={deliverables ?? []}
            deliveryEmailSentAt={deliveryNotification?.sent_at ?? null}
          />

          <section className="space-y-4">
            <SectionIntro
              eyebrow="Media"
              title="Upload and sync deliverables"
              body="Use Fotello for photo galleries, iGUIDE for tours and floor plans, and video links for YouTube/Drive/Dropbox deliveries."
            />
            <FotelloSection
              bookingId={booking.id}
              initialListingId={booking.fotello_listing_id}
              deliverables={(deliverables ?? [])
                .filter((d) => d.source === "fotello")
                .map((d) => ({
                  id: d.id,
                  external_id: d.external_id,
                  status: d.metadata?.status ?? null,
                  shotType: d.metadata?.shot_type ?? null,
                  syncedAt: d.metadata?.last_synced_at ?? d.created_at,
                }))}
            />

            <IGuideSection
              bookingId={booking.id}
              initialIGuideId={booking.iguide_id}
              initialPortalId={booking.iguide_portal_id}
              portalApiConfigured={await hasPortalCredentials()}
              job={iguideJob ?? null}
            />
          </section>

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

          <Panel title="Delivery links">
            {otherDeliverables.length > 0 ? (
              <ul className="divide-y divide-white/5">
                {otherDeliverables.map((d) => (
                  <li key={d.id} className="py-2">
                    <p className="text-sm font-semibold text-white">
                      {deliverableTypeLabel(d.type)}
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-ink-muted">
                        {d.source}
                      </span>
                    </p>
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener"
                      className="mt-0.5 block truncate text-xs text-brand-light underline"
                    >
                      {d.url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">
                Video, iGUIDE, floor plan, and manual links will appear here.
                Fotello galleries are managed in the Fotello section.
              </p>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-ink/50 p-3">
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
    <div className="rounded-lg border border-white/10 bg-ink-soft/50 p-4">
      <p className="text-[11px] uppercase tracking-wider text-ink-muted">
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
    <div className="flex flex-wrap justify-between gap-2">
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
