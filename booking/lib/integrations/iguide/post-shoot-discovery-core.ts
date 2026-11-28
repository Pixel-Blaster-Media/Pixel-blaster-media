import { readyAddressKey } from "./sync";

const hour = 60 * 60 * 1000;
export const DISCOVERY_WINDOW_MS = 36 * hour;
const EARLY_CREATION_MS = 4 * hour;
export const eligibleIGuideServices = [
  "blue_print", "social_media_special", "social_media_plus", "ultimate",
  "signature_property_campaign", "iguide_tour", "iguide_measurements", "floor_plan",
];
export const discoveryBookingStatuses = ["confirmed", "shot", "editing"];

export type DiscoveryBooking = {
  id: string;
  status: string;
  scheduled_at: string | null;
  scheduled_ends_at: string | null;
  iguide_id: string | null;
  iguide_portal_id: string | null;
  unit_number: string | null;
  properties: { street_address: string; city: string | null; postal_code: string | null } | null;
};

export type DiscoveryTour = {
  id: string;
  addressKey: string;
  createdAt: number;
  stage: "awaiting_upload" | "processing" | "published" | "found";
};

export function discoveryDue(booking: DiscoveryBooking, now: number): boolean {
  const start = Date.parse(booking.scheduled_at ?? "");
  const end = Date.parse(booking.scheduled_ends_at ?? "");
  return discoveryBookingStatuses.includes(booking.status) &&
    !booking.iguide_id && !booking.iguide_portal_id &&
    Number.isFinite(start) && start <= end && end <= now &&
    end > now - DISCOVERY_WINDOW_MS;
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function projectDiscoveryTour(item: {
  id: string; raw?: Record<string, unknown>; status?: string | null; createdAt?: string | null;
}): DiscoveryTour | null {
  const property = item.raw?.property;
  if (!property || typeof property !== "object" || Array.isArray(property)) return null;
  const p = property as Record<string, unknown>;
  const number = clean(p.streetNumber);
  const street = clean(p.streetName);
  if (!number || !street) return null;
  // If a unit was provided in a shape we do not understand, fail closed.
  const unit = clean(p.unit) ?? (typeof p.unit === "number" && Number.isSafeInteger(p.unit) ? String(p.unit) : null);
  if (p.unit != null && p.unit !== "" && !unit) return null;
  const addressKey = readyAddressKey(number + " " + street, unit, clean(p.city), clean(p.postalCode));
  const createdAt = Date.parse(item.createdAt ?? "");
  if (!addressKey || !Number.isFinite(createdAt) || !/^ig[a-z0-9]+$/i.test(item.id)) return null;
  const status = item.status?.toLowerCase();
  if (status === "cancelled" || status === "rejected" || status === "archived") return null;
  const stage = status === "empty" ? "awaiting_upload"
    : status && ["processing", "pending_draft", "pending_qa", "pending_publish"].includes(status)
      ? "processing" : status === "published" ? "published" : "found";
  return { id: item.id, addressKey, createdAt, stage };
}

export function selectDiscoveryTour(booking: DiscoveryBooking, neighbors: DiscoveryBooking[], tours: DiscoveryTour[], now: number) {
  if (!discoveryDue(booking, now)) return null;
  const keyOf = (row: DiscoveryBooking) => readyAddressKey(
    row.properties?.street_address, row.unit_number, row.properties?.city, row.properties?.postal_code,
  );
  const key = keyOf(booking);
  if (!key) return null;
  const earliest = Date.parse(booking.scheduled_at ?? "") - EARLY_CREATION_MS;
  // Other appointments can be eligible later, or already bound to a different tour.
  // An address collision in the same time window is not safe to guess.
  if (neighbors.some((b) => b.id !== booking.id && keyOf(b) === key &&
      Math.abs(Date.parse(b.scheduled_at ?? "") - Date.parse(booking.scheduled_at ?? "")) <= DISCOVERY_WINDOW_MS)) return null;
  const matches = tours.filter((t) => t.addressKey === key && t.createdAt >= earliest && t.createdAt <= now);
  return matches.length === 1 ? matches[0] : null;
}
