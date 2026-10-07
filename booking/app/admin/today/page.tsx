import Link from "next/link";
import type { Metadata } from "next";

import { BOOKING_STATUSES } from "@/lib/booking/booking-status";
import {
  BUSINESS_TZ,
  businessDateTimeLocalToUtc,
} from "@/lib/booking/availability";
import type { InternalShootNotesSnapshot } from "@/lib/booking/internal-shoot-notes-core";
import { loadBookingInternalNotes } from "@/lib/booking/internal-shoot-notes-server";
import { labelForAddOn, labelForService } from "@/lib/booking/services";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  parseRealtorAIMemory,
  summarizeRealtorAIMemory,
} from "@/lib/realtors/memory";
import { getServerSupabase } from "@/lib/supabase/server";
import { Suspense, type ReactNode } from "react";
import { loadShootWeather, type ShootWeather } from "./weather";
import type {
  BookingStatus,
  DeliverableSource,
  DeliverableType,
  Json,
} from "@/lib/supabase/database.types";
import AdminPageHeading from "../AdminPageHeading";
import InternalShootNotesEditor from "../internal-shoot-notes/InternalShootNotesEditor";
import {
  loadTodayCommandPreferences,
} from "./actions";
import DailyAIBriefPanel from "./DailyAIBriefPanel";
import OfflineTodaySnapshot, {
  type OfflineTodayData,
} from "./OfflineTodaySnapshot";
import type { TodayCommandPreferences } from "./preferences";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

interface BookingRow {
  id: string;
  status: BookingStatus;
  scheduled_at: string | null;
  scheduled_ends_at: string | null;
  services: string[];
  add_ons: string[];
  square_footage: number | null;
  client_notes: string | null;
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
    ai_memory: Json | null;
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
    return <p className="text-sm text-red-700">Could not build today view.</p>;
  }

  const admin = await requireAdmin();
  const supabase = await getServerSupabase();
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select(
      "id, status, scheduled_at, scheduled_ends_at, services, add_ons, square_footage, client_notes, unit_number, iguide_id, iguide_portal_id, properties(street_address, city, province, postal_code), profiles(full_name, email, phone, brokerage, internal_notes, delivery_cc_emails, ai_memory)",
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
      <p className="text-sm text-red-700">
        Could not load today&apos;s shoots: {error.message}
      </p>
    );
  }

  const bookingIds = (bookings ?? []).map((booking) => booking.id);
  const [privateNotesByBooking, { data: deliverables }, preferences] = await Promise.all([
    loadBookingInternalNotes({ organizationId: admin.organizationId, actorId: admin.userId, bookingIds }),
    bookingIds.length > 0
      ? supabase.from("deliverables").select("booking_id, type, source, ready_at, metadata").in("booking_id", bookingIds).returns<DeliverableRow[]>()
      : Promise.resolve({ data: [] as DeliverableRow[] }),
    loadTodayCommandPreferences(admin.organizationId),
  ]);

  const deliverablesByBooking = new Map<string, DeliverableRow[]>();
  for (const deliverable of deliverables ?? []) {
    deliverablesByBooking.set(deliverable.booking_id, [
      ...(deliverablesByBooking.get(deliverable.booking_id) ?? []),
      deliverable,
    ]);
  }

  const offlineTodayData: OfflineTodayData = {
    dateLabel: formatFullDate(start),
    updatedAt: new Date().toISOString(),
    shoots: (bookings ?? []).map((booking) => ({
      id: booking.id,
      time: booking.scheduled_at ? formatTime(booking.scheduled_at) : "Time TBD",
      address: booking.properties?.street_address ?? "Address not set",
      city: booking.properties?.city ?? "",
      packageName:
        booking.services.map(labelForService).join(", ") || "Package not set",
      status: BOOKING_STATUSES[booking.status].label,
    })),
  };

  return (
    <div className="space-y-4">
      <OfflineTodaySnapshot userId={admin.userId} data={offlineTodayData} />
      <AdminPageHeading
        eyebrow={formatFullDate(start)}
        title="A clear view of your day."
        meta={`${(bookings ?? []).length} shoot${(bookings ?? []).length === 1 ? "" : "s"}`}
      />
      <dl className="studio-stats" aria-label="Today’s schedule summary">
        <div><dt>Today’s shoots</dt><dd>{(bookings ?? []).length}</dd></div>
        <div><dt>Confirmed today</dt><dd>{(bookings ?? []).filter(b => b.status === "confirmed").length}</dd></div>
        <div><dt>Shot or editing today</dt><dd>{(bookings ?? []).filter(b => b.status === "shot" || b.status === "editing").length}</dd></div>
      </dl>
      <div className="studio-today-layout"><section aria-labelledby="today-schedule-title">
      <h2 id="today-schedule-title" className="studio-section-title">Today’s shoots</h2>

      {bookings && bookings.length > 0 ? (
        <ol className="space-y-4">
          {bookings.map((booking) => (
            <ShootCard
              key={booking.id}
              booking={booking}
              draftScope={admin.userId}
              privateShootNotes={
                privateNotesByBooking.get(booking.id) ?? {
                  notes: null,
                  revision: 0,
                }
              }
              deliverables={deliverablesByBooking.get(booking.id) ?? []}
              preferences={preferences}
              defaultOpen={bookings.length <= 2}
              weather={<Suspense fallback={<WeatherPlaceholder />}><DeferredShootWeather booking={booking} organizationId={admin.organizationId} /></Suspense>}
            />
          ))}
        </ol>
      ) : (
        <p className="rounded-2xl border border-dashed border-realtor-primary/15 bg-realtor-surface/60 px-4 py-8 text-center text-sm text-realtor-muted">
          No shoots scheduled today.
        </p>
      )}
      </section><aside aria-label="Day overview"><h2 className="studio-section-title">Your day, at a glance</h2><TodayOverview bookings={bookings ?? []} preferences={preferences} /></aside></div>
    </div>
  );
}

function TodayOverview({
  bookings,
  preferences,
}: {
  bookings: BookingRow[];
  preferences: TodayCommandPreferences;
}) {
  const timed = timedBookings(bookings);
  const routeHref =
    googleDayRouteHref(timed) ?? (timed[0] ? googleMapHref(timed[0]) : undefined);
  const firstStart = timed[0]?.scheduled_at ?? null;
  const lastEnd =
    [...timed].reverse().find((booking) => booking.scheduled_ends_at)
      ?.scheduled_ends_at ??
    timed[timed.length - 1]?.scheduled_at ??
    null;
  const cities = Array.from(
    new Set(
      timed
        .map((booking) => booking.properties?.city?.trim())
        .filter((city): city is string => Boolean(city)),
    ),
  );
  const actionButtons = (
    <>
      <Link
        href="/admin/calendar"
        className="tap-target inline-flex items-center rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
      >
        Calendar
      </Link>
      {routeHref ? (
        <a
          href={routeHref}
          target="_blank"
          rel="noopener noreferrer"
          className="tap-target inline-flex items-center rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
        >
          Open route
        </a>
      ) : null}
    </>
  );

  return (
    <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-3 shadow-sm">
      {preferences.showShootBrief ? (
        <DailyAIBriefPanel actions={actionButtons} />
      ) : (
        <div className="flex flex-wrap gap-2">{actionButtons}</div>
      )}

      <div className="mt-3 rounded-2xl border border-realtor-primary/15 bg-white/65 p-3">
        <div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-realtor-muted">
              {bookings.length === 1
                ? "One shoot today"
                : `${bookings.length} shoots today`}
            </p>
            <p className="mt-1 text-sm font-semibold text-realtor-text">
              {cities.length ? cities.join(" → ") : "No city listed"}
            </p>
            <p className="mt-0.5 text-xs text-realtor-muted">
              {bookings.length === 0
                ? "Nothing scheduled yet."
                : `${firstStart ? `Starts ${formatTime(firstStart)}` : "Start time TBD"} · ${
                    lastEnd ? `Ends ${formatTime(lastEnd)}` : "End time TBD"
                  }`}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ShootCard({
  booking,
  draftScope,
  privateShootNotes,
  deliverables,
  preferences,
  defaultOpen,
  weather,
}: {
  booking: BookingRow;
  draftScope: string;
  privateShootNotes: InternalShootNotesSnapshot;
  deliverables: DeliverableRow[];
  preferences: TodayCommandPreferences;
  defaultOpen: boolean;
  weather: ReactNode;
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
  const briefItems = shootBriefItems(booking, taskState, preferences);
  const agentMemory = summarizeRealtorAIMemory(
    parseRealtorAIMemory(profile?.ai_memory),
  );

  return (
    <li className="studio-shoot-card">
      <details className="group" open={defaultOpen}>
        <summary className="relative flex cursor-pointer list-none items-start gap-3 md:justify-between [&::-webkit-details-marker]:hidden">
          <div className="min-w-0 flex-1">
            <p className="pr-28 text-xs font-semibold uppercase tracking-wider text-realtor-primary md:pr-0">
              {booking.scheduled_at ? formatTime(booking.scheduled_at) : "No time"}
              {booking.scheduled_ends_at
                ? `-${formatTime(booking.scheduled_ends_at)}`
                : ""}
            </p>
            <h2 className="mt-1 pr-28 text-lg font-semibold text-realtor-text md:pr-0">
              {addressLine || "Unknown address"}
            </h2>
            <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-realtor-muted">
              <span>
                {[property?.city, property?.postal_code].filter(Boolean).join(" ")}
              </span>
              {weather}
            </p>
          </div>
          <div className="absolute right-0 top-0 flex items-center gap-2 md:static">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${status.pill}`}
            >
              {status.label}
            </span>
            <span className="rounded-full border border-realtor-primary/15 bg-white px-2 py-0.5 text-[10px] font-semibold text-realtor-muted group-open:hidden">
              Open
            </span>
            <span className="hidden rounded-full border border-realtor-primary/15 bg-white px-2 py-0.5 text-[10px] font-semibold text-realtor-muted group-open:inline">
              Close
            </span>
          </div>
        </summary>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-realtor-primary/15 bg-white/65 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
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
                  className="rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
                >
                  Email
                </a>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-realtor-primary/15 bg-white/65 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
            Services
          </p>
          <div className="mt-1 flex items-start justify-between gap-3">
            <p className="min-w-0 text-sm text-realtor-text">
              {services.length ? services.join(", ") : "No services listed"}
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
                href={`/admin/bookings/${booking.id}`}
                className="rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
              >
                Open
              </Link>
            </div>
          </div>
        </div>
      </div>

      {preferences.showShootBrief ? (
      <div className="mt-3 rounded-2xl border border-realtor-primary/20 bg-realtor-primary/10 p-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-realtor-primary">
          AI shoot brief
        </p>
        <ul className="mt-2 grid gap-2 text-sm text-realtor-muted md:grid-cols-2">
          {briefItems.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-realtor-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
      ) : null}

      {preferences.showDeliverables ? (
      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
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
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/admin/bookings/${booking.id}`}
          className="rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
        >
          Add media
        </Link>
        <Link
          href={`/admin/bookings/${booking.id}?tab=delivery`}
          className="rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
        >
          Delivery
        </Link>
      </div>

      {preferences.showBookingNotes ? (
        <div className="mt-4 space-y-2">
          {booking.client_notes ? (
            <NoteDisclosure title="Realtor notes" body={booking.client_notes} />
          ) : null}
          <InternalShootNotesEditor
            bookingId={booking.id}
            draftScope={draftScope}
            initialNotes={privateShootNotes.notes}
            initialRevision={privateShootNotes.revision}
          />
        </div>
      ) : null}

      {preferences.showAgentMemory &&
      (profile?.internal_notes || agentMemory.length > 0) ? (
        <div className="mt-2 space-y-2">
          {profile?.internal_notes ? (
            <NoteDisclosure title="Agent memory notes" body={profile.internal_notes} />
          ) : null}
          {agentMemory.length > 0 ? (
            <NoteDisclosure title="AI memory" body={agentMemory.join("\n")} />
          ) : null}
        </div>
      ) : null}
      </details>
      <div className="studio-shoot-footer"><span>{services.join(" · ") || "Services not set"}</span><Link href={`/admin/bookings/${booking.id}`}>Open booking →<span className="sr-only"> {addressLine}</span></Link></div>
    </li>
  );
}

function NoteDisclosure({ title, body }: { title: string; body: string }) {
  return (
    <details className="group rounded-2xl border border-realtor-primary/15 bg-white/65 p-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wider text-realtor-muted [&::-webkit-details-marker]:hidden">
        {title}
        <span className="rounded-full border border-realtor-primary/15 bg-white px-2 py-0.5 text-[10px] normal-case tracking-normal text-realtor-muted group-open:hidden">
          Show
        </span>
        <span className="hidden rounded-full border border-realtor-primary/15 bg-white px-2 py-0.5 text-[10px] normal-case tracking-normal text-realtor-muted group-open:inline">
          Hide
        </span>
      </summary>
      <p className="mt-1 whitespace-pre-wrap text-sm text-realtor-muted">{body}</p>
    </details>
  );
}

function WeatherPlaceholder() {
  return <span className="studio-weather studio-weather-placeholder" role="status"><span aria-hidden="true">◌</span> Loading forecast…</span>;
}

async function DeferredShootWeather({ booking, organizationId }: { booking: BookingRow; organizationId: string }) {
  const weather = await loadShootWeather(booking, organizationId);
  return <span className="studio-weather" aria-live="polite"><ShootWeatherLine weather={weather} /></span>;
}

function ShootWeatherLine({ weather }: { weather: ShootWeather | null }) {
  if (!weather) return <span>Forecast unavailable</span>;
  const condition =
    weather.temperatureC != null
      ? `${Math.round(weather.temperatureC)}°${weather.weatherCode != null ? ` ${shortWeatherLabel(weather.weatherCode)}` : ""}`
      : weather.weatherCode != null
        ? shortWeatherLabel(weather.weatherCode)
        : null;
  const chips = [
    condition,
    weather.windKph != null ? `${Math.round(weather.windKph)} km/h wind` : null,
    weather.cloudCover != null ? `${weather.cloudCover}% clouds` : null,
    weather.precipitationProbability != null
      ? `${weather.precipitationProbability}% rain`
      : null,
  ].filter((chip): chip is string => Boolean(chip));

  if (!chips.length) return <span>Forecast unavailable</span>;

  return (
    <>
      <span className="text-realtor-muted/40">·</span>
      {chips.map((chip) => (
        <span
          key={chip}
          className="whitespace-nowrap text-xs font-medium after:ml-1.5 after:text-realtor-muted/40 after:content-['•'] last:after:hidden"
        >
          {chip}
        </span>
      ))}
    </>
  );
}

function shortWeatherLabel(code: number): string {
  if (code === 0) return "clear";
  if (code <= 3) return "cloudy";
  if (code <= 48) return "fog";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "showers";
  if (code <= 86) return "snow";
  if (code <= 99) return "storm";
  return "weather";
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
      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
      : state === "pending"
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : "border-realtor-primary/15 bg-white/65 text-realtor-muted";
  return { label, className, state };
}

function timedBookings(bookings: BookingRow[]): BookingRow[] {
  return bookings
    .filter((booking) => booking.scheduled_at)
    .sort(
      (a, b) =>
        new Date(a.scheduled_at ?? "").getTime() -
        new Date(b.scheduled_at ?? "").getTime(),
    );
}

function googleDayRouteHref(bookings: BookingRow[]): string | undefined {
  const addresses = bookings.map(fullAddress).filter(Boolean);
  if (addresses.length === 0) return undefined;
  if (addresses.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      addresses[0],
    )}`;
  }
  const qs = new URLSearchParams({
    api: "1",
    origin: addresses[0],
    destination: addresses[addresses.length - 1],
    travelmode: "driving",
  });
  const waypoints = addresses.slice(1, -1);
  if (waypoints.length > 0) qs.set("waypoints", waypoints.join("|"));
  return `https://www.google.com/maps/dir/?${qs.toString()}`;
}

function googleMapHref(booking: BookingRow): string | undefined {
  const query = fullAddress(booking);
  if (!query) return undefined;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    query,
  )}`;
}

function fullAddress(booking: BookingRow): string {
  return [
    booking.properties?.street_address,
    booking.unit_number ? `Unit ${booking.unit_number}` : null,
    booking.properties?.city,
    booking.properties?.province,
    booking.properties?.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
}

function shootBriefItems(
  booking: BookingRow,
  tasks: Array<{ label: string; state: "done" | "pending" | "todo" }>,
  preferences: TodayCommandPreferences,
): string[] {
  const items: string[] = [];
  const serviceText = [...booking.services, ...booking.add_ons]
    .join(" ")
    .toLowerCase();

  if (preferences.showAgentMemory && booking.profiles?.internal_notes) {
    items.push(`Client preference: ${booking.profiles.internal_notes}`);
  }
  if (preferences.showAgentMemory && booking.profiles?.ai_memory) {
    for (const memory of summarizeRealtorAIMemory(
      parseRealtorAIMemory(booking.profiles.ai_memory),
    ).slice(0, 2)) {
      items.push(memory);
    }
  }
  if (preferences.showBookingNotes && booking.client_notes) {
    items.push(`Realtor note: ${booking.client_notes}`);
  }
  if (booking.square_footage && booking.square_footage >= 3000) {
    items.push("Larger property: watch timing, exterior coverage, and iGUIDE/floor-plan expectations.");
  }
  if (serviceText.includes("iguide") || booking.iguide_id || booking.iguide_portal_id) {
    items.push("iGUIDE job: confirm basement scope and measurement access before leaving.");
  }
  if (serviceText.includes("video") || serviceText.includes("reel")) {
    items.push("Video/social: grab vertical hero clips, exterior movement, and one clean intro/outro option.");
  }
  if (
    preferences.showDeliverables &&
    tasks.some((task) => task.state === "todo")
  ) {
    items.push("Delivery prep: media links are not complete yet, so double-check upload/sync after the shoot.");
  }
  if (
    preferences.showAgentMemory &&
    booking.profiles?.delivery_cc_emails?.length
  ) {
    items.push(`${booking.profiles.delivery_cc_emails.length} saved CC email${booking.profiles.delivery_cc_emails.length === 1 ? "" : "s"} will be included on delivery.`);
  }

  return items.slice(0, 6).length
    ? items.slice(0, 6)
    : ["No special warnings. Confirm access, lights, lockbox, and any must-have rooms on arrival."];
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
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

function formatCompactDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    weekday: "short",
    month: "short",
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
