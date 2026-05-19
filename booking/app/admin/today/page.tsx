import Link from "next/link";
import type { Metadata } from "next";

import { BOOKING_STATUSES } from "@/lib/booking/booking-status";
import {
  BUSINESS_TZ,
  businessDateTimeLocalToUtc,
} from "@/lib/booking/availability";
import { labelForAddOn, labelForService } from "@/lib/booking/services";
import { requireAdmin } from "@/lib/auth/require-admin";
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
    internal_notes: string | null;
    delivery_cc_emails: string[] | null;
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

  const admin = await requireAdmin();
  const supabase = await getServerSupabase();
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select(
      "id, status, scheduled_at, scheduled_ends_at, services, add_ons, client_notes, internal_notes, unit_number, iguide_id, iguide_portal_id, properties(street_address, city, province, postal_code), profiles(full_name, email, phone, brokerage, internal_notes, delivery_cc_emails)",
    )
    .eq("organization_id", admin.organizationId)
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

  const summary = buildDailySummary(bookings ?? [], deliverablesByBooking);

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-white/10 bg-ink-soft/55 p-4 shadow-lg shadow-black/10">
        <div className="flex flex-wrap items-end justify-between gap-3">
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
          className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-ink-muted transition hover:border-white/30 hover:text-white"
        >
          Calendar
        </Link>
        </div>
      </header>

      <DailyCommandCenter
        bookings={bookings ?? []}
        deliverablesByBooking={deliverablesByBooking}
        summary={summary}
      />

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
        <p className="rounded-2xl border border-dashed border-white/10 bg-ink-soft/40 px-4 py-8 text-center text-sm text-ink-muted">
          No shoots scheduled today.
        </p>
      )}
    </div>
  );
}

function DailyCommandCenter({
  bookings,
  deliverablesByBooking,
  summary,
}: {
  bookings: BookingRow[];
  deliverablesByBooking: Map<string, DeliverableRow[]>;
  summary: DailySummary;
}) {
  const nextShoot = bookings.find(
    (booking) =>
      booking.scheduled_at && new Date(booking.scheduled_at).getTime() >= Date.now(),
  );
  const attention = bookings
    .map((booking) => ({
      booking,
      tasks: taskStates(booking, deliverablesByBooking.get(booking.id) ?? []).filter(
        (task) => task.state !== "done",
      ),
    }))
    .filter((item) => item.tasks.length > 0)
    .slice(0, 5);
  const memoryRows = bookings
    .filter((booking) => booking.internal_notes || booking.profiles?.internal_notes)
    .slice(0, 4);

  return (
    <section className="rounded-2xl border border-white/10 bg-ink-soft/55 p-4 shadow-lg shadow-black/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
            Command center
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            Today at a glance
          </h2>
        </div>
        {nextShoot ? (
          <Link
            href={`/admin/bookings/${nextShoot.id}`}
            className="rounded-full border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand-light transition hover:bg-brand/20"
          >
            Next: {nextShoot.scheduled_at ? formatTime(nextShoot.scheduled_at) : ""}
          </Link>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile label="Shoots" value={String(summary.total)} />
        <SummaryTile label="Ready media" value={String(summary.withReadyMedia)} />
        <SummaryTile label="Need attention" value={String(summary.needingAttention)} />
        <SummaryTile label="Memory notes" value={String(summary.withMemory)} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-ink/45 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Needs attention
          </p>
          {attention.length > 0 ? (
            <div className="mt-2 space-y-2">
              {attention.map(({ booking, tasks }) => (
                <Link
                  key={booking.id}
                  href={`/admin/bookings/${booking.id}`}
                  className="block rounded-xl border border-white/10 bg-white/[0.03] p-3 transition hover:border-brand-light/50"
                >
                  <span className="block text-sm font-semibold text-white">
                    {booking.scheduled_at ? `${formatTime(booking.scheduled_at)} · ` : ""}
                    {booking.properties?.street_address ?? "Unknown address"}
                  </span>
                  <span className="mt-1 block text-xs text-ink-muted">
                    {tasks.map((task) => task.label).join(" · ")}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">
              Nothing urgent flagged from today&apos;s media checklist.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-ink/45 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Agent memory
          </p>
          {memoryRows.length > 0 ? (
            <div className="mt-2 space-y-2">
              {memoryRows.map((booking) => (
                <Link
                  key={booking.id}
                  href={`/admin/bookings/${booking.id}`}
                  className="block rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 transition hover:border-amber-300/45"
                >
                  <span className="block text-sm font-semibold text-white">
                    {booking.profiles?.full_name ??
                      booking.profiles?.email ??
                      "Realtor"}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs text-amber-100/80">
                    {booking.internal_notes ?? booking.profiles?.internal_notes}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">
              No agent memory notes attached to today&apos;s shoots.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-ink/45 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
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
    <li className="rounded-2xl border border-white/10 bg-ink-soft/55 p-4 shadow-lg shadow-black/10">
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
        <div className="rounded-2xl border border-white/10 bg-ink/50 p-3">
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
                className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-light"
              >
                Call
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
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-ink/50 p-3">
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
                className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-light"
              >
                Map
              </a>
            ) : null}
            <Link
              href={`/admin/bookings/${booking.id}`}
              className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white transition hover:border-brand-light"
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
          href={`/admin/bookings/${booking.id}`}
          className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white transition hover:border-brand-light"
        >
          Add media
        </Link>
        <Link
          href={`/admin/bookings/${booking.id}?tab=delivery`}
          className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white transition hover:border-brand-light"
        >
          Delivery
        </Link>
      </div>
    </li>
  );
}

function NoteBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-ink/50 p-3">
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
): Array<{ label: string; className: string; state: "done" | "pending" | "todo" }> {
  const hasPhotosReady = deliverables.some(
    (d) => d.source !== "fotello" && d.type === "photo_gallery" && d.ready_at,
  );
  const hasPhotosPending = deliverables.some(
    (d) => d.source !== "fotello" && d.type === "photo_gallery" && !d.ready_at,
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
      hasPhotosReady
        ? "Photos ready"
        : hasPhotosPending
          ? "Photos pending"
          : "Photos not linked",
      hasPhotosReady ? "done" : hasPhotosPending ? "pending" : "todo",
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
  return { label, className, state };
}

interface DailySummary {
  total: number;
  withReadyMedia: number;
  needingAttention: number;
  withMemory: number;
}

function buildDailySummary(
  bookings: BookingRow[],
  deliverablesByBooking: Map<string, DeliverableRow[]>,
): DailySummary {
  return {
    total: bookings.length,
    withReadyMedia: bookings.filter((booking) =>
      (deliverablesByBooking.get(booking.id) ?? []).some(
        (deliverable) =>
          deliverable.source !== "fotello" && Boolean(deliverable.ready_at),
      ),
    ).length,
    needingAttention: bookings.filter((booking) =>
      taskStates(booking, deliverablesByBooking.get(booking.id) ?? []).some(
        (task) => task.state !== "done",
      ),
    ).length,
    withMemory: bookings.filter(
      (booking) => booking.internal_notes || booking.profiles?.internal_notes,
    ).length,
  };
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
