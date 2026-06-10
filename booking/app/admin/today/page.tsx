import Link from "next/link";
import type { Metadata } from "next";

import { BOOKING_STATUSES } from "@/lib/booking/booking-status";
import {
  BUSINESS_TZ,
  businessDateTimeLocalToUtc,
} from "@/lib/booking/availability";
import { labelForAddOn, labelForService } from "@/lib/booking/services";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  parseRealtorAIMemory,
  summarizeRealtorAIMemory,
} from "@/lib/realtors/memory";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCredential } from "@/lib/integrations/credentials";
import type {
  BookingStatus,
  DeliverableSource,
  DeliverableType,
  Json,
} from "@/lib/supabase/database.types";
import {
  loadTodayCommandPreferences,
} from "./actions";
import DailyAIBriefPanel from "./DailyAIBriefPanel";
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

interface ShootWeather {
  location: string;
  temperatureC: number | null;
  windKph: number | null;
  cloudCover: number | null;
  precipitationProbability: number | null;
  weatherCode: number | null;
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
      "id, status, scheduled_at, scheduled_ends_at, services, add_ons, square_footage, client_notes, internal_notes, unit_number, iguide_id, iguide_portal_id, properties(street_address, city, province, postal_code), profiles(full_name, email, phone, brokerage, internal_notes, delivery_cc_emails, ai_memory)",
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

  const preferences = await loadTodayCommandPreferences(admin.organizationId);
  const weatherEntries = await Promise.all(
    (bookings ?? []).map(async (booking) => [
      booking.id,
      await getShootWeather(booking, admin.organizationId),
    ] as const),
  );
  const weatherByBooking = new Map(weatherEntries);

  return (
    <div className="space-y-6">
      <TodayOverview
        date={start}
        bookings={bookings ?? []}
        preferences={preferences}
      />

      {bookings && bookings.length > 0 ? (
        <ol className="space-y-4">
          {bookings.map((booking) => (
            <ShootCard
              key={booking.id}
              booking={booking}
              deliverables={deliverablesByBooking.get(booking.id) ?? []}
              preferences={preferences}
              defaultOpen={bookings.length <= 2}
              weather={weatherByBooking.get(booking.id) ?? null}
            />
          ))}
        </ol>
      ) : (
        <p className="rounded-2xl border border-dashed border-realtor-primary/15 bg-realtor-surface/60 px-4 py-8 text-center text-sm text-realtor-muted">
          No shoots scheduled today.
        </p>
      )}
    </div>
  );
}

function TodayOverview({
  date,
  bookings,
  preferences,
}: {
  date: Date;
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
        className="rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
      >
        Calendar
      </Link>
      {routeHref ? (
        <a
          href={routeHref}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
        >
          Open route
        </a>
      ) : null}
    </>
  );

  return (
    <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-4 shadow-lg shadow-realtor-text/10">
      <div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-realtor-primary">
            {formatFullDate(date)}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-realtor-text">
            Today at a glance
          </h1>
          <p className="mt-2 text-sm text-realtor-muted">
            Shoot-day controls and a quick brief when you need one.
          </p>
        </div>
      </div>

      {preferences.showShootBrief ? (
        <DailyAIBriefPanel actions={actionButtons} />
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">{actionButtons}</div>
      )}

      <div className="mt-4 rounded-2xl border border-realtor-primary/15 bg-white/65 p-3">
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
  deliverables,
  preferences,
  defaultOpen,
  weather,
}: {
  booking: BookingRow;
  deliverables: DeliverableRow[];
  preferences: TodayCommandPreferences;
  defaultOpen: boolean;
  weather: ShootWeather | null;
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
    <li className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-4 shadow-lg shadow-realtor-text/10">
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
              <ShootWeatherLine weather={weather} />
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

      {preferences.showBookingNotes &&
      (booking.client_notes || booking.internal_notes) ? (
        <div className="mt-4 space-y-2">
          {booking.client_notes ? (
            <NoteDisclosure title="Realtor notes" body={booking.client_notes} />
          ) : null}
          {booking.internal_notes ? (
            <NoteDisclosure title="Internal notes" body={booking.internal_notes} />
          ) : null}
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

function ShootWeatherLine({ weather }: { weather: ShootWeather | null }) {
  if (!weather) return null;
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

  if (!chips.length) return null;

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

async function getShootWeather(
  booking: BookingRow,
  organizationId: string,
): Promise<ShootWeather | null> {
  if (!booking.scheduled_at) return null;
  const coords = await geocodeBookingArea(booking, organizationId);
  if (!coords) return null;
  const params = new URLSearchParams({
    latitude: String(coords.latitude),
    longitude: String(coords.longitude),
    hourly:
      "temperature_2m,precipitation_probability,weather_code,cloud_cover,wind_speed_10m",
    timezone: BUSINESS_TZ,
    forecast_days: "2",
  });

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      next: { revalidate: 900 },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      hourly?: {
        time?: string[];
        temperature_2m?: number[];
        precipitation_probability?: number[];
        weather_code?: number[];
        cloud_cover?: number[];
        wind_speed_10m?: number[];
      };
    };
    const index = hourlyIndex(json.hourly?.time ?? [], booking.scheduled_at);
    if (index == null) return null;

    return {
      location: coords.label,
      temperatureC: numeric(json.hourly?.temperature_2m?.[index]),
      windKph: numeric(json.hourly?.wind_speed_10m?.[index]),
      cloudCover: numeric(json.hourly?.cloud_cover?.[index]),
      precipitationProbability: numeric(
        json.hourly?.precipitation_probability?.[index],
      ),
      weatherCode: numeric(json.hourly?.weather_code?.[index]),
    };
  } catch {
    return null;
  }
}

async function geocodeBookingArea(
  booking: BookingRow,
  organizationId: string,
): Promise<{
  latitude: number;
  longitude: number;
  label: string;
  source: "shoot";
} | null> {
  const city = booking.properties?.city?.trim();
  const province = booking.properties?.province?.trim() ?? "ON";
  const address = fullAddress(booking);
  const googleCoords = await geocodeWithGoogle(address, organizationId);
  if (googleCoords) return googleCoords;

  const queries = [city].filter(
    (query, index, list): query is string =>
      Boolean(query) && list.indexOf(query) === index,
  );

  for (const query of queries) {
    const coords = await geocodeWithOpenMeteo(query, province);
    if (coords) return coords;
  }

  return null;
}

async function geocodeWithGoogle(
  address: string,
  organizationId: string,
): Promise<{
  latitude: number;
  longitude: number;
  label: string;
  source: "shoot";
} | null> {
  if (!address) return null;
  const apiKey =
    (await getCredential(
      "google_maps",
      "api_key",
      "GOOGLE_MAPS_SERVER_API_KEY",
      organizationId,
    )) ??
    process.env.GOOGLE_ROUTES_API_KEY?.trim() ??
    null;
  if (!apiKey) return null;

  try {
    const params = new URLSearchParams({
      address,
      key: apiKey,
    });
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${params}`,
      { next: { revalidate: 86400 } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status?: string;
      results?: Array<{
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
        address_components?: Array<{
          long_name?: string;
          types?: string[];
        }>;
      }>;
    };
    const result = json.results?.[0];
    const latitude = result?.geometry?.location?.lat;
    const longitude = result?.geometry?.location?.lng;
    if (
      json.status !== "OK" ||
      typeof latitude !== "number" ||
      typeof longitude !== "number"
    ) {
      return null;
    }
    const locality =
      result?.address_components?.find((component) =>
        component.types?.includes("locality"),
      )?.long_name ??
      result?.address_components?.find((component) =>
        component.types?.includes("postal_town"),
      )?.long_name ??
      result?.address_components?.find((component) =>
        component.types?.includes("administrative_area_level_3"),
      )?.long_name;
    return {
      latitude,
      longitude,
      label: locality ?? result?.formatted_address ?? "Shoot location",
      source: "shoot",
    };
  } catch {
    return null;
  }
}

async function geocodeWithOpenMeteo(
  query: string,
  province: string,
): Promise<{
  latitude: number;
  longitude: number;
  label: string;
  source: "shoot";
} | null> {
  try {
    const params = new URLSearchParams({
      name: query,
      count: "5",
      language: "en",
      format: "json",
    });
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?${params}`,
      { next: { revalidate: 86400 } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      results?: Array<{
        latitude?: number;
        longitude?: number;
        name?: string;
        admin1?: string;
        country_code?: string;
      }>;
    };
    const provinceKey = normalize(province);
    const result =
      json.results?.find(
        (entry) =>
          entry.country_code === "CA" &&
          (!provinceKey || normalize(entry.admin1) === provinceKey),
      ) ??
      json.results?.find((entry) => entry.country_code === "CA") ??
      json.results?.[0];
    if (
      typeof result?.latitude !== "number" ||
      typeof result.longitude !== "number"
    ) {
      return null;
    }
    return {
      latitude: result.latitude,
      longitude: result.longitude,
      label: [result.name, result.admin1].filter(Boolean).join(", ") || query,
      source: "shoot",
    };
  } catch {
    return null;
  }
}

function numeric(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hourlyIndex(times: string[], scheduledAt: string): number | null {
  if (!times.length) return null;
  const target = localHourKey(scheduledAt);
  const exact = times.indexOf(target);
  if (exact >= 0) return exact;

  const targetTime = new Date(scheduledAt).getTime();
  let bestIndex = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let index = 0; index < times.length; index += 1) {
    const timestamp = businessDateTimeLocalToUtc(times[index]);
    if (!timestamp) continue;
    const delta = Math.abs(timestamp.getTime() - targetTime);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  }
  return Number.isFinite(bestDelta) ? bestIndex : null;
}

function localHourKey(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:00`;
}

function weatherLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Fog";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 99) return "Storm risk";
  return "Forecast";
}

interface RouteInsight {
  key: string;
  level: "info" | "warning" | "danger";
  title: string;
  body: string;
  badges: string[];
  href?: string;
}

interface NextRoute {
  level: "info" | "warning" | "danger";
  label: string;
  href?: string;
}

interface RoutePlan {
  mode: "v1" | "v2";
  insights: RouteInsight[];
  nextRoutes: Map<string, NextRoute>;
}

async function buildRoutePlan(
  bookings: BookingRow[],
  organizationId: string,
): Promise<RoutePlan> {
  const apiKey =
    (await getCredential(
      "google_maps",
      "api_key",
      "GOOGLE_MAPS_SERVER_API_KEY",
      organizationId,
    )) ??
    process.env.GOOGLE_ROUTES_API_KEY?.trim() ??
    null;
  if (!apiKey) return buildV1RoutePlan(bookings);

  const timed = timedBookings(bookings);
  const insights: RouteInsight[] = [];
  const nextRoutes = new Map<string, NextRoute>();

  for (let i = 0; i < timed.length - 1; i += 1) {
    const current = timed[i];
    const next = timed[i + 1];
    const estimate = await computeGoogleRouteEstimate({
      apiKey,
      from: current,
      to: next,
    });

    if (!estimate) {
      const fallback = buildV1PairRoute(current, next);
      if (fallback.insight) insights.push(fallback.insight);
      nextRoutes.set(current.id, fallback.nextRoute);
      continue;
    }

    const pair = buildV2PairRoute(current, next, estimate);
    if (pair.insight) insights.push(pair.insight);
    nextRoutes.set(current.id, pair.nextRoute);
  }

  if (timed.length === 1) {
    const only = timed[0];
    insights.push(singleShootInsight(only));
  }

  return {
    mode: "v2",
    insights: insights.slice(0, 5),
    nextRoutes,
  };
}

function buildV1RoutePlan(bookings: BookingRow[]): RoutePlan {
  const timed = timedBookings(bookings);
  const insights: RouteInsight[] = [];
  const nextRoutes = new Map<string, NextRoute>();

  for (let i = 0; i < timed.length - 1; i += 1) {
    const current = timed[i];
    const next = timed[i + 1];
    const pair = buildV1PairRoute(current, next);
    if (pair.insight) insights.push(pair.insight);
    nextRoutes.set(current.id, pair.nextRoute);
  }

  if (timed.length === 1) insights.push(singleShootInsight(timed[0]));

  return {
    mode: "v1",
    insights: insights.slice(0, 5),
    nextRoutes,
  };
}

function emptyRoutePlan(mode: "v1" | "v2"): RoutePlan {
  return { mode, insights: [], nextRoutes: new Map() };
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

function buildV1PairRoute(
  current: BookingRow,
  next: BookingRow,
): { insight: RouteInsight | null; nextRoute: NextRoute } {
  const currentEnd = current.scheduled_ends_at ?? current.scheduled_at;
  const nextStart = next.scheduled_at ?? "";
  const gapMinutes = Math.round(
    (new Date(nextStart).getTime() - new Date(currentEnd ?? "").getTime()) /
      60000,
  );
  const cityChanged =
    normalize(current.properties?.city) !== normalize(next.properties?.city);
  const routeHref = googleRouteHref(current, next);
  const fromLabel = current.properties?.street_address ?? "current shoot";
  const toLabel = next.properties?.street_address ?? "next shoot";
  const leaveBy = currentEnd ? formatTime(currentEnd) : null;
  const cityBadge = cityChanged
    ? `${current.properties?.city ?? "First city"} → ${
        next.properties?.city ?? "next city"
      }`
    : current.properties?.city || next.properties?.city || "Same area";
  const badges = [
    `${Math.max(gapMinutes, 0)} min between`,
    leaveBy ? `Leave by ${leaveBy}` : null,
    cityBadge,
  ].filter((badge): badge is string => Boolean(badge));

    if (gapMinutes < 0) {
      return {
        insight: {
          key: `overlap-${current.id}-${next.id}`,
          level: "danger",
          title: `Schedule overlap before ${formatTime(nextStart)}`,
          body: `${toLabel} starts before ${fromLabel} is scheduled to end. Adjust the calendar before the day gets away from you.`,
          badges,
          href: routeHref,
        },
        nextRoute: {
          level: "danger",
          label: `${toLabel} overlaps this booking. Calendar needs attention.`,
          href: routeHref,
        },
      };
    } else if (gapMinutes < 30) {
      return {
        insight: {
          key: `tight-${current.id}-${next.id}`,
          level: "danger",
          title: `${gapMinutes} min gap before ${formatTime(nextStart)}`,
          body:
            "This is very tight once packing, driving, parking, and access time are included.",
          badges,
          href: routeHref,
        },
        nextRoute: {
          level: "danger",
          label: `Next: ${toLabel}. Leave by ${leaveBy}; ${gapMinutes} min scheduled gap.`,
          href: routeHref,
        },
      };
    } else if (gapMinutes < 60) {
      return {
        insight: {
          key: `gap-${current.id}-${next.id}`,
          level: "warning",
          title: `${gapMinutes} min gap before ${formatTime(nextStart)}`,
          body:
            "This should work if the first shoot ends cleanly, but check the route before leaving.",
          badges,
          href: routeHref,
        },
        nextRoute: {
          level: "warning",
          label: `Next: ${toLabel}. Leave by ${leaveBy}; ${gapMinutes} min scheduled gap.`,
          href: routeHref,
        },
      };
    } else if (cityChanged) {
      return {
        insight: {
          key: `city-${current.id}-${next.id}`,
          level: "info",
          title: "City change between shoots",
          body: `${fromLabel} to ${toLabel}. Open the route before leaving so there are no surprises.`,
          badges,
          href: routeHref,
        },
        nextRoute: {
          level: "info",
          label: `Next: ${toLabel}. Leave by ${leaveBy}; ${gapMinutes} min scheduled gap.`,
          href: routeHref,
        },
      };
    }

  return {
    insight: null,
    nextRoute: {
      level: "info",
      label: `Next: ${toLabel}. Leave by ${leaveBy}; ${gapMinutes} min scheduled gap.`,
      href: routeHref,
    },
  };
}

function singleShootInsight(only: BookingRow): RouteInsight {
  return {
    key: `single-${only.id}`,
    level: "info",
    title: "One shoot today",
    body: "Open the map before leaving and check parking/access notes.",
    badges: [
      only.scheduled_at ? `Starts ${formatTime(only.scheduled_at)}` : "Timed shoot",
      only.properties?.city ?? "Address ready",
    ],
    href: googleMapHref(only),
  };
}

interface GoogleRouteEstimate {
  travelMinutes: number;
  distanceKm: number;
}

async function computeGoogleRouteEstimate({
  apiKey,
  from,
  to,
}: {
  apiKey: string;
  from: BookingRow;
  to: BookingRow;
}): Promise<GoogleRouteEstimate | null> {
  const origin = fullAddress(from);
  const destination = fullAddress(to);
  if (!origin || !destination) return null;

  const departureTime =
    from.scheduled_ends_at && new Date(from.scheduled_ends_at).getTime() > Date.now()
      ? from.scheduled_ends_at
      : undefined;

  try {
    const res = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
        },
        body: JSON.stringify({
          origin: { address: origin },
          destination: { address: destination },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
          ...(departureTime ? { departureTime } : {}),
        }),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      routes?: Array<{ duration?: string; distanceMeters?: number }>;
    };
    const route = json.routes?.[0];
    const seconds = parseGoogleDurationSeconds(route?.duration);
    if (!seconds) return null;
    return {
      travelMinutes: Math.max(1, Math.round(seconds / 60)),
      distanceKm:
        typeof route?.distanceMeters === "number"
          ? Math.round((route.distanceMeters / 1000) * 10) / 10
          : 0,
    };
  } catch {
    return null;
  }
}

function buildV2PairRoute(
  current: BookingRow,
  next: BookingRow,
  estimate: GoogleRouteEstimate,
): { insight: RouteInsight | null; nextRoute: NextRoute } {
  const currentEnd = current.scheduled_ends_at ?? current.scheduled_at;
  const nextStart = next.scheduled_at ?? "";
  const scheduledGap = Math.round(
    (new Date(nextStart).getTime() - new Date(currentEnd ?? "").getTime()) /
      60000,
  );
  const bufferMinutes = scheduledGap - estimate.travelMinutes;
  const routeHref = googleRouteHref(current, next);
  const fromLabel = current.properties?.street_address ?? "current shoot";
  const toLabel = next.properties?.street_address ?? "next shoot";
  const leaveBy = currentEnd ? formatTime(currentEnd) : null;
  const badges = [
    `${estimate.travelMinutes} min drive`,
    estimate.distanceKm ? `${estimate.distanceKm} km` : null,
    `${bufferMinutes} min buffer`,
    leaveBy ? `Leave by ${leaveBy}` : null,
    estimate.distanceKm >= 45 ? "Travel fee check" : null,
  ].filter((badge): badge is string => Boolean(badge));

  const nextRoute: NextRoute = {
    level:
      bufferMinutes < 15 || scheduledGap < 0
        ? "danger"
        : bufferMinutes < 30
          ? "warning"
          : "info",
    label: `Next: ${toLabel}. ${estimate.travelMinutes} min drive; ${bufferMinutes} min buffer.`,
    href: routeHref,
  };

  if (scheduledGap < 0) {
    return {
      insight: {
        key: `v2-overlap-${current.id}-${next.id}`,
        level: "danger",
        title: `Schedule overlap before ${formatTime(nextStart)}`,
        body: `${toLabel} starts before ${fromLabel} is scheduled to end.`,
        badges,
        href: routeHref,
      },
      nextRoute,
    };
  }
  if (bufferMinutes < 15) {
    return {
      insight: {
        key: `v2-tight-${current.id}-${next.id}`,
        level: "danger",
        title: `${bufferMinutes} min route buffer before ${formatTime(nextStart)}`,
        body:
          "Google drive-time leaves almost no room for packing, parking, access, or traffic weirdness.",
        badges,
        href: routeHref,
      },
      nextRoute,
    };
  }
  if (bufferMinutes < 30) {
    return {
      insight: {
        key: `v2-warning-${current.id}-${next.id}`,
        level: "warning",
        title: `${bufferMinutes} min route buffer before ${formatTime(nextStart)}`,
        body:
          "This can work, but it is worth opening the route before leaving.",
        badges,
        href: routeHref,
      },
      nextRoute,
    };
  }
  if (estimate.distanceKm >= 45) {
    return {
      insight: {
        key: `v2-distance-${current.id}-${next.id}`,
        level: "info",
        title: "Longer drive between shoots",
        body: `${fromLabel} to ${toLabel}. Consider whether this should carry a travel fee or extra buffer.`,
        badges,
        href: routeHref,
      },
      nextRoute,
    };
  }

  return { insight: null, nextRoute };
}

function parseGoogleDurationSeconds(value: string | undefined): number | null {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value ?? "");
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function buildRouteSummary(insights: RouteInsight[]): {
  alerts: number;
  label: string;
} {
  const danger = insights.filter((insight) => insight.level === "danger").length;
  const warning = insights.filter((insight) => insight.level === "warning").length;
  if (danger > 0) {
    return {
      alerts: danger + warning,
      label: `${danger} urgent route issue${danger === 1 ? "" : "s"} to check.`,
    };
  }
  if (warning > 0) {
    return {
      alerts: warning,
      label: `${warning} tight schedule gap${warning === 1 ? "" : "s"} today.`,
    };
  }
  if (insights.length > 0) {
    return {
      alerts: 0,
      label: "Routes look reasonable. Open maps before heading out.",
    };
  }
  return {
    alerts: 0,
    label: "Add timed shoots to get route guidance.",
  };
}

function googleRouteHref(from: BookingRow, to: BookingRow): string | undefined {
  const origin = fullAddress(from);
  const destination = fullAddress(to);
  if (!origin || !destination) return undefined;
  const qs = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving",
  });
  return `https://www.google.com/maps/dir/?${qs.toString()}`;
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

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
