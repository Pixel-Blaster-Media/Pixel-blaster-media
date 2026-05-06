import Link from "next/link";
import type { Metadata } from "next";

import { BOOKING_STATUSES } from "@/lib/booking/booking-status";
import {
  BUSINESS_TZ,
  businessDateTimeLocalToUtc,
} from "@/lib/booking/availability";
import { labelForAddOn, labelForService } from "@/lib/booking/services";
import { getServerSupabase } from "@/lib/supabase/server";
import type {
  BookingStatus,
  DeliverableSource,
  DeliverableType,
} from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

interface BookingRow {
  id: string;
  status: BookingStatus;
  scheduled_at: string | null;
  scheduled_ends_at: string | null;
  services: string[];
  add_ons: string[];
  client_notes: string | null;
  internal_notes: string | null;
  unit_number: string | null;
  fotello_listing_id: string | null;
  iguide_id: string | null;
  iguide_portal_id: string | null;
  properties: {
    street_address: string;
    city: string | null;
    province: string | null;
    postal_code: string | null;
  } | null;
  profiles: {
    full_name: string | null;
    email: string;
    phone: string | null;
    brokerage: string | null;
  } | null;
}

interface DeliverableRow {
  booking_id: string;
  type: DeliverableType;
  source: DeliverableSource;
  ready_at: string | null;
  metadata: { status?: string } | null;
}

export default async function AdminTodayPage() {
  const todayKey = localDateKey(new Date());
  const start = businessDateTimeLocalToUtc(`${todayKey}T00:00`);
  const end = businessDateTimeLocalToUtc(`${addDaysKey(todayKey, 1)}T00:00`);

  if (!start || !end) {
    return <p className="text-sm text-red-300">Could not build today view.</p>;
  }

  const supabase = await getServerSupabase();
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select(
      "id, status, scheduled_at, scheduled_ends_at, services, add_ons, client_notes, internal_notes, unit_number, fotello_listing_id, iguide_id, iguide_portal_id, properties(street_address, city, province, postal_code), profiles(full_name, email, phone, brokerage)",
    )
    .not("scheduled_at", "is", null)
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString())
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: true })
    .returns<BookingRow[]>();

  if (error) {
    return (
      <p className="text-sm text-red-300">
        Could not load today&apos;s shoots: {error.message}
      </p>
    );
  }

  const bookingIds = (bookings ?? []).map((booking) => booking.id);
  const { data: deliverables } =
    bookingIds.length > 0
      ? await supabase
          .from("deliverables")
          .select("booking_id, type, source, ready_at, metadata")
          .in("booking_id", bookingIds)
          .returns<DeliverableRow[]>()
      : { data: [] as DeliverableRow[] };

  const deliverablesByBooking = new Map<string, DeliverableRow[]>();
  for (const deliverable of deliverables ?? []) {
    deliverablesByBooking.set(deliverable.booking_id, [
      ...(deliverablesByBooking.get(deliverable.booking_id) ?? []),
      deliverable,
    ]);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
            {formatFullDate(start)}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-white">Today</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Shoot-day view for addresses, contacts, notes, and upload tasks.
          </p>
        </div>
        <Link
          href="/admin/calendar"
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-ink-muted hover:border-white/30 hover:text-white"
        >
          Calendar
        </Link>
      </header>

      {bookings && bookings.length > 0 ? (
        <ol className="space-y-4">
          {bookings.map((booking) => (
            <ShootCard
              key={booking.id}
              booking={booking}
              deliverables={deliverablesByBooking.get(booking.id) ?? []}
            />
          ))}
        </ol>
      ) : (
        <p className="rounded-lg border border-dashed border-white/10 bg-ink-soft/40 px-4 py-8 text-center text-sm text-ink-muted">
          No shoots scheduled today.
        </p>
      )}
    </div>
  );
}

function ShootCard({
  booking,
  deliverables,
}: {
  booking: BookingRow;
  deliverables: DeliverableRow[];
}) {
  const property = booking.properties;
  const profile = booking.profiles;
  const status = BOOKING_STATUSES[booking.status];
  const addressLine = [
    property?.street_address,
    booking.unit_number ? `Unit ${booking.unit_number}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const fullAddress = [
    addressLine,
    property?.city,
    property?.province,
    property?.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
  const services = [
    ...booking.services.map(labelForService),
    ...booking.add_ons.map(labelForAddOn),
  ];
  const taskState = taskStates(booking, deliverables);

  return (
    <li className="rounded-lg border border-white/10 bg-ink-soft/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-light">
            {booking.scheduled_at ? formatTime(booking.scheduled_at) : "No time"}
            {booking.scheduled_ends_at
              ? `-${formatTime(booking.scheduled_ends_at)}`
              : ""}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            {addressLine || "Unknown address"}
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            {[property?.city, property?.postal_code].filter(Boolean).join(" ")}
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${status.pill}`}
        >
          {status.label}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-white/10 bg-ink/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Realtor
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {profile?.full_name ?? profile?.email ?? "Unknown"}
          </p>
          {profile?.brokerage ? (
            <p className="text-xs text-ink-muted">{profile.brokerage}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {profile?.phone ? (
              <a
                href={`tel:${profile.phone}`}
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-light"
              >
                Call
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
          </div>
        </div>

        <div className="rounded-md border border-white/10 bg-ink/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Services
          </p>
          <p className="mt-1 text-sm text-white">
            {services.length ? services.join(", ") : "No services listed"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {fullAddress ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  fullAddress,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-light"
              >
                Map
              </a>
            ) : null}
            <Link
              href={`/admin/bookings/${booking.id}`}
              className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white hover:border-brand-light"
            >
              Open booking
            </Link>
          </div>
        </div>
      </div>

      {booking.client_notes || booking.internal_notes ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {booking.client_notes ? (
            <NoteBlock title="Realtor notes" body={booking.client_notes} />
          ) : null}
          {booking.internal_notes ? (
            <NoteBlock title="Internal notes" body={booking.internal_notes} />
          ) : null}
        </div>
      ) : null}

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Delivery checklist
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {taskState.map((task) => (
            <span
              key={task.label}
              className={`rounded-full border px-2 py-1 text-[11px] ${task.className}`}
            >
              {task.label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/admin/bookings/${booking.id}#fotello`}
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white hover:border-brand-light"
        >
          Fotello upload
        </Link>
        <Link
          href={`/admin/bookings/${booking.id}#iguide`}
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white hover:border-brand-light"
        >
          iGUIDE
        </Link>
      </div>
    </li>
  );
}

function NoteBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-ink/50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {title}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{body}</p>
    </div>
  );
}

function taskStates(
  booking: BookingRow,
  deliverables: DeliverableRow[],
): Array<{ label: string; className: string }> {
  const hasFotelloReady = deliverables.some(
    (d) => d.source === "fotello" && d.ready_at,
  );
  const hasFotelloPending = deliverables.some(
    (d) => d.source === "fotello" && !d.ready_at,
  );
  const hasIGuideReady = deliverables.some(
    (d) => d.source === "iguide" && d.type === "virtual_tour" && d.ready_at,
  );
  const hasFloorPlanReady = deliverables.some(
    (d) => d.type === "floor_plan" && d.ready_at,
  );
  const hasVideoReady = deliverables.some(
    (d) => (d.type === "video" || d.type === "aerial") && d.ready_at,
  );

  return [
    chip(
      hasFotelloReady
        ? "Photos ready"
        : hasFotelloPending
          ? "Photos processing"
          : "Photos not uploaded",
      hasFotelloReady ? "done" : hasFotelloPending ? "pending" : "todo",
    ),
    chip(
      hasIGuideReady
        ? "iGUIDE ready"
        : booking.iguide_id || booking.iguide_portal_id
          ? "iGUIDE linked"
          : "iGUIDE not linked",
      hasIGuideReady
        ? "done"
        : booking.iguide_id || booking.iguide_portal_id
          ? "pending"
          : "todo",
    ),
    chip(hasFloorPlanReady ? "Floor plan ready" : "Floor plan pending", hasFloorPlanReady ? "done" : "todo"),
    chip(hasVideoReady ? "Video ready" : "Video pending", hasVideoReady ? "done" : "todo"),
  ];
}

function chip(label: string, state: "done" | "pending" | "todo") {
  const className =
    state === "done"
      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
      : state === "pending"
        ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
        : "border-white/10 bg-white/[0.03] text-ink-muted";
  return { label, className };
}

function localDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDaysKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatFullDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
