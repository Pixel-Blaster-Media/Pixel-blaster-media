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
}

export interface AddOnOption {
  id: AddOnId;
  label: string;
  blurb: string;
}

export const SERVICES: ServiceOption[] = [
  {
    id: "real_estate_photos",
    label: "Real Estate Photography",
    blurb: "HDR interior + exterior. Same-next-day delivery.",
  },
  {
    id: "iguide_tour",
    label: "iGuide Virtual Tour",
    blurb: "3D tour with measured floor plans, delivered through your portal.",
  },
  {
    id: "floor_plan",
    label: "Floor Plan Only",
    blurb: "iGuide-measured floor plan without the full virtual tour.",
  },
  {
    id: "drone",
    label: "Drone / Aerial",
    blurb: "Aerial stills + short video clips (weather permitting).",
  },
  {
    id: "walkthrough_video",
    label: "Walkthrough Video",
    blurb: "Cinematic listing video, edited for social or MLS.",
  },
];

export const ADD_ONS: AddOnOption[] = [
  {
    id: "twilight",
    label: "Twilight exterior",
    blurb: "Return shoot at golden / blue hour for hero exterior shots.",
  },
  {
    id: "virtual_staging",
    label: "Virtual staging",
    blurb: "Furnish empty rooms digitally, per-room pricing.",
  },
  {
    id: "rush_24h",
    label: "Rush — 24h delivery",
    blurb: "Bumped to the front of the editing queue.",
  },
];

export const PREFERRED_TIMES = [
  { id: "morning", label: "Morning (8am–12pm)" },
  { id: "afternoon", label: "Afternoon (12pm–4pm)" },
  { id: "evening", label: "Evening (4pm–7pm)" },
  { id: "flexible", label: "Flexible" },
] as const;

export type PreferredTime = (typeof PREFERRED_TIMES)[number]["id"];

const SERVICE_LABEL_BY_ID: Record<ServiceId, string> = Object.fromEntries(
  SERVICES.map((s) => [s.id, s.label]),
) as Record<ServiceId, string>;

const ADDON_LABEL_BY_ID: Record<AddOnId, string> = Object.fromEntries(
  ADD_ONS.map((a) => [a.id, a.label]),
) as Record<AddOnId, string>;

export function labelForService(id: string): string {
  return SERVICE_LABEL_BY_ID[id as ServiceId] ?? id;
}

export function labelForAddOn(id: string): string {
  return ADDON_LABEL_BY_ID[id as AddOnId] ?? id;
}

export function isValidServiceId(id: string): id is ServiceId {
  return id in SERVICE_LABEL_BY_ID;
}

export function isValidAddOnId(id: string): id is AddOnId {
  return id in ADDON_LABEL_BY_ID;
}
