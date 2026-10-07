import "server-only";
import { BUSINESS_TZ, businessDateTimeLocalToUtc } from "@/lib/booking/availability";
import { getCredential } from "@/lib/integrations/credentials";

export interface WeatherBooking {
  scheduled_at: string | null;
  unit_number: string | null;
  properties: { street_address: string; city: string | null; province: string | null; postal_code: string | null } | null;
}
export interface ShootWeather {
  location: string;
  temperatureC: number | null;
  windKph: number | null;
  cloudCover: number | null;
  precipitationProbability: number | null;
  weatherCode: number | null;
}

// Optional providers cannot keep this streaming boundary pending indefinitely.
// One deadline covers credential lookup, both geocoders, and the forecast.
export async function loadShootWeather(booking: WeatherBooking, organizationId: string, timeoutMs = 5000): Promise<ShootWeather | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs);
  });
  try {
    return await Promise.race([getShootWeather(booking, organizationId, controller.signal).catch(() => null), deadline]);
  } finally { clearTimeout(timer); }
}

async function getShootWeather(
  booking: WeatherBooking,
  organizationId: string,
  signal: AbortSignal,
): Promise<ShootWeather | null> {
  if (!booking.scheduled_at) return null;
  const coords = await geocodeBookingArea(booking, organizationId, signal);
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
      signal,
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
  booking: WeatherBooking,
  organizationId: string,
  signal: AbortSignal,
): Promise<{
  latitude: number;
  longitude: number;
  label: string;
  source: "shoot";
} | null> {
  const city = booking.properties?.city?.trim();
  const province = booking.properties?.province?.trim() ?? "ON";
  const address = fullAddress(booking);
  const googleCoords = await geocodeWithGoogle(address, organizationId, signal);
  if (googleCoords) return googleCoords;

  const queries = [city].filter(
    (query, index, list): query is string =>
      Boolean(query) && list.indexOf(query) === index,
  );

  for (const query of queries) {
    const coords = await geocodeWithOpenMeteo(query, province, signal);
    if (coords) return coords;
  }

  return null;
}

async function geocodeWithGoogle(
  address: string,
  organizationId: string,
  signal: AbortSignal,
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
      { signal, next: { revalidate: 86400 } },
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
  signal: AbortSignal,
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
      { signal, next: { revalidate: 86400 } },
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

function fullAddress(booking: WeatherBooking): string {
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

function normalize(value: string | null | undefined): string { return (value ?? "").trim().toLowerCase(); }
