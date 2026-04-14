/**
 * Catalog of bookable services + add-ons.
 *
 * Single source of truth used by the booking form, the email templates, and
 * (eventually) the admin promotion flow. The `id` is what gets persisted in
 * `booking_requests.services` / `add_ons` (text[]); the label/blurb are
 * UI-only.
 */

export type ServiceId =
  | "real_estate_photos"
  | "iguide_tour"
  | "floor_plan"
  | "drone"
  | "walkthrough_video";

export type AddOnId =
  | "twilight"
  | "virtual_staging"
  | "rush_24h";

export interface ServiceOption {
  id: ServiceId;
  label: string;
  blurb: string;
  /**
   * On-site duration in minutes. Drive time + prep are baked in — the
   * calendar does not apply an additional buffer between shoots.
   *
   * Seed values are reasonable defaults for a solo real-estate photographer
   * in the GTA. Once pulled from Acuity in a later phase these become the
   * real numbers. Used for:
   *   - computing total booking length when a realtor picks multiple services
   *   - rendering slot heights in the calendar grid
   */
  durationMinutes: number;
}

export interface AddOnOption {
  id: AddOnId;
  label: string;
  blurb: string;
  /** Minutes to add to the on-site total when selected. */
  durationMinutes: number;
}

export const SERVICES: ServiceOption[] = [
  {
    id: "real_estate_photos",
    label: "Real Estate Photography",
    blurb: "HDR interior + exterior. Same-next-day delivery.",
    durationMinutes: 90,
  },
  {
    id: "iguide_tour",
    label: "iGuide Virtual Tour",
    blurb: "3D tour with measured floor plans, delivered through your portal.",
    durationMinutes: 120,
  },
  {
    id: "floor_plan",
    label: "Floor Plan Only",
    blurb: "iGuide-measured floor plan without the full virtual tour.",
    durationMinutes: 60,
  },
  {
    id: "drone",
    label: "Drone / Aerial",
    blurb: "Aerial stills + short video clips (weather permitting).",
    durationMinutes: 30,
  },
  {
    id: "walkthrough_video",
    label: "Walkthrough Video",
    blurb: "Cinematic listing video, edited for social or MLS.",
    durationMinutes: 60,
  },
];

export const ADD_ONS: AddOnOption[] = [
  {
    id: "twilight",
    label: "Twilight exterior",
    blurb: "Return shoot at golden / blue hour for hero exterior shots.",
    durationMinutes: 45,
  },
  {
    id: "virtual_staging",
    label: "Virtual staging",
    blurb: "Furnish empty rooms digitally, per-room pricing.",
    durationMinutes: 0,
  },
  {
    id: "rush_24h",
    label: "Rush — 24h delivery",
    blurb: "Bumped to the front of the editing queue.",
    durationMinutes: 0,
  },
];

const SERVICE_BY_ID: Record<ServiceId, ServiceOption> = Object.fromEntries(
  SERVICES.map((s) => [s.id, s]),
) as Record<ServiceId, ServiceOption>;

const ADDON_BY_ID: Record<AddOnId, AddOnOption> = Object.fromEntries(
  ADD_ONS.map((a) => [a.id, a]),
) as Record<AddOnId, AddOnOption>;

/**
 * Sum the on-site minutes for a booking's chosen services + add-ons.
 * Unknown ids are ignored rather than thrown so a stale catalog entry
 * on an old booking doesn't blow up the calendar.
 */
export function totalDurationMinutes(
  services: readonly string[],
  addOns: readonly string[] = [],
): number {
  let total = 0;
  for (const id of services) {
    total += SERVICE_BY_ID[id as ServiceId]?.durationMinutes ?? 0;
  }
  for (const id of addOns) {
    total += ADDON_BY_ID[id as AddOnId]?.durationMinutes ?? 0;
  }
  return total;
}

export const PREFERRED_TIMES = [
  { id: "morning", label: "Morning (8am–12pm)" },
  { id: "afternoon", label: "Afternoon (12pm–4pm)" },
  { id: "evening", label: "Evening (4pm–7pm)" },
  { id: "flexible", label: "Flexible" },
] as const;

export type PreferredTime = (typeof PREFERRED_TIMES)[number]["id"];

export function labelForService(id: string): string {
  return SERVICE_BY_ID[id as ServiceId]?.label ?? id;
}

export function labelForAddOn(id: string): string {
  return ADDON_BY_ID[id as AddOnId]?.label ?? id;
}

export function isValidServiceId(id: string): id is ServiceId {
  return id in SERVICE_BY_ID;
}

export function isValidAddOnId(id: string): id is AddOnId {
  return id in ADDON_BY_ID;
}
