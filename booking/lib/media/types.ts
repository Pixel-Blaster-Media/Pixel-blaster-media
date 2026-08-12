function immutableVocabulary<const Values extends readonly string[]>(
  ...values: Values
): Readonly<Values> {
  return Object.freeze(values);
}

export const INGEST_STATES = immutableVocabulary(
  "discovered",
  "url_ready",
  "fetching",
  "quarantined",
  "validating",
  "scanning",
  "accepted",
  "deriving",
  "review_pending",
  "retryable",
  "source_expired",
  "reconciliation_required",
  "rejected",
  "dead_letter",
);

export type IngestState = (typeof INGEST_STATES)[number];

export const RELEASE_STATES = immutableVocabulary(
  "draft",
  "review_pending",
  "changes_requested",
  "revision_processing",
  "approved",
  "packaging",
  "ready",
  "published",
  "superseded",
  "withdrawn",
);

export type ReleaseState = (typeof RELEASE_STATES)[number];

export const DERIVATIVE_CLASSES = immutableVocabulary(
  "master",
  "full_res",
  "mls",
  "web",
  "thumbnail",
);

export type DerivativeClass = (typeof DERIVATIVE_CLASSES)[number];

export const MEDIA_PROFILE_IDS = immutableVocabulary(
  "original.camera.v1",
  "client.fullres.share.v1",
  "ontario.proptx.provisional.2026-08-11.v1",
  "web.listing.320.v1",
  "web.listing.640.v1",
  "web.listing.1280.v1",
  "web.listing.2048.v1",
  "thumbnail.admin.320.v1",
);

export type MediaProfileId = (typeof MEDIA_PROFILE_IDS)[number];

export const MEDIA_PROFILE_CAPABILITIES = immutableVocabulary(
  "canonical_master",
  "client_download",
  "destination_export",
  "listing_display",
  "admin_thumbnail",
);

export type MediaProfileCapability = (typeof MEDIA_PROFILE_CAPABILITIES)[number];
export type MediaProfileStatus = "defined" | "provisional";
