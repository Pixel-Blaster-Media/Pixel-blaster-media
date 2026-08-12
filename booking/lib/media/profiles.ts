import {
  MEDIA_PROFILE_CAPABILITIES,
  MEDIA_PROFILE_IDS,
  type DerivativeClass,
  type MediaProfileCapability,
  type MediaProfileId,
  type MediaProfileStatus,
} from "./types.ts";

export type MediaProfileDefinition = Readonly<{
  id: MediaProfileId;
  label: string;
  derivativeClass: DerivativeClass;
  status: MediaProfileStatus;
  effectiveDate: string;
  capabilities: readonly MediaProfileCapability[];
}>;

function defineProfile(
  id: MediaProfileId,
  label: string,
  derivativeClass: DerivativeClass,
  capabilities: readonly MediaProfileCapability[],
  status: MediaProfileStatus = "defined",
): MediaProfileDefinition {
  return Object.freeze({
    id,
    label,
    derivativeClass,
    status,
    effectiveDate: "2026-08-11",
    capabilities: Object.freeze([...capabilities]),
  });
}

export const mediaProfiles = Object.freeze({
  "original.camera.v1": defineProfile(
    "original.camera.v1",
    "Original camera master",
    "master",
    ["canonical_master"],
  ),
  "client.fullres.share.v1": defineProfile(
    "client.fullres.share.v1",
    "Client full-resolution download",
    "full_res",
    ["client_download"],
  ),
  "ontario.proptx.provisional.2026-08-11.v1": defineProfile(
    "ontario.proptx.provisional.2026-08-11.v1",
    "Provisional Ontario preset",
    "mls",
    ["client_download", "destination_export"],
    "provisional",
  ),
  "web.listing.320.v1": defineProfile(
    "web.listing.320.v1",
    "Listing web 320",
    "web",
    ["listing_display"],
  ),
  "web.listing.640.v1": defineProfile(
    "web.listing.640.v1",
    "Listing web 640",
    "web",
    ["listing_display"],
  ),
  "web.listing.1280.v1": defineProfile(
    "web.listing.1280.v1",
    "Listing web 1280",
    "web",
    ["listing_display"],
  ),
  "web.listing.2048.v1": defineProfile(
    "web.listing.2048.v1",
    "Listing web 2048",
    "web",
    ["listing_display"],
  ),
  "thumbnail.admin.320.v1": defineProfile(
    "thumbnail.admin.320.v1",
    "Admin thumbnail 320",
    "thumbnail",
    ["admin_thumbnail"],
  ),
} satisfies Record<MediaProfileId, MediaProfileDefinition>);

const profileIdSet = new Set<string>(MEDIA_PROFILE_IDS);
const capabilitySet = new Set<string>(MEDIA_PROFILE_CAPABILITIES);

export function isMediaProfileId(value: unknown): value is MediaProfileId {
  return typeof value === "string" && profileIdSet.has(value);
}

export function getMediaProfile(value: unknown): MediaProfileDefinition | null {
  return isMediaProfileId(value) ? mediaProfiles[value] : null;
}

export function profileSupports(profileId: unknown, capability: unknown): boolean {
  if (!isMediaProfileId(profileId) || typeof capability !== "string" || !capabilitySet.has(capability)) {
    return false;
  }
  return mediaProfiles[profileId].capabilities.includes(capability as MediaProfileCapability);
}
