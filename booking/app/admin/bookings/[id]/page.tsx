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

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getServerSupabase();

  const [{ data: booking, error: bookErr }, { data: deliverables }] =
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
    ]);

  if (bookErr || !booking) notFound();

  const property = booking.properties;
  const profile = booking.profiles;
  const meta = BOOKING_STATUSES[booking.status];
  const transitions = nextBookingStatuses(booking.status);

  return (
    <div className="space-y-8">
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

      <header>
        <h1 className="text-2xl font-bold text-white">
          {property?.street_address ?? "—"}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {[property?.city, property?.postal_code].filter(Boolean).join(" ")}
          {booking.scheduled_at
            ? ` · ${new Date(booking.scheduled_at).toLocaleString()}`
            : " · no date set"}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
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

        <Panel title="Shoot">
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
          <Row
            label="Unit #"
            value={booking.unit_number ? booking.unit_number : "—"}
          />
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
      </div>

      {booking.client_notes ? (
        <Panel title="Realtor notes">
          <p className="whitespace-pre-wrap text-sm text-ink-muted">
            {booking.client_notes}
          </p>
        </Panel>
      ) : null}

      <BookingActions
        bookingId={booking.id}
        currentStatus={booking.status}
        transitions={transitions}
        deliverables={deliverables ?? []}
      />

      <IGuideSection
        bookingId={booking.id}
        initialIGuideId={booking.iguide_id}
        initialPortalId={booking.iguide_portal_id}
        portalApiConfigured={await hasPortalCredentials()}
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

      {(() => {
        const otherDeliverables = (deliverables ?? []).filter(
          (d) => d.source !== "fotello",
        );
        return (
          <Panel title="Deliverables">
            {otherDeliverables.length > 0 ? (
              <ul className="divide-y divide-white/5">
                {otherDeliverables.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-start justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
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
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">
                No non-Fotello deliverables yet. Fotello galleries are
                managed in the Fotello section above.
              </p>
            )}
          </Panel>
        );
      })()}
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
