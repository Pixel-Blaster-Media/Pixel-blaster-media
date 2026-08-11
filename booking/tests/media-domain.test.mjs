import assert from "node:assert/strict";
import test from "node:test";

import {
  DERIVATIVE_CLASSES,
  INGEST_STATES,
  MEDIA_PROFILE_CAPABILITIES,
  MEDIA_PROFILE_IDS,
  RELEASE_STATES,
} from "../lib/media/types.ts";
import {
  getMediaProfile,
  isMediaProfileId,
  mediaProfiles,
  profileSupports,
} from "../lib/media/profiles.ts";
import {
  canTransitionIngest,
  canTransitionRelease,
  ingestTransitions,
  releaseTransitions,
} from "../lib/media/states.ts";

const ingestStates = [
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
];

const releaseStates = [
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
];

test("canonical media vocabularies are immutable and drive runtime registries", () => {
  for (const vocabulary of [
    INGEST_STATES,
    RELEASE_STATES,
    DERIVATIVE_CLASSES,
    MEDIA_PROFILE_IDS,
    MEDIA_PROFILE_CAPABILITIES,
  ]) {
    assert.equal(Object.isFrozen(vocabulary), true);
  }
  assert.deepEqual([...INGEST_STATES].sort(), Object.keys(ingestTransitions).sort());
  assert.deepEqual([...RELEASE_STATES].sort(), Object.keys(releaseTransitions).sort());
  assert.deepEqual([...MEDIA_PROFILE_IDS].sort(), Object.keys(mediaProfiles).sort());
  assert.throws(() => INGEST_STATES.push("attacker_controlled"), TypeError);
});

test("media state maps explicitly cover every supported state and are immutable", () => {
  assert.deepEqual(Object.keys(ingestTransitions).sort(), [...ingestStates].sort());
  assert.deepEqual(Object.keys(releaseTransitions).sort(), [...releaseStates].sort());
  for (const transitions of [...Object.values(ingestTransitions), ...Object.values(releaseTransitions)]) {
    assert.equal(Object.isFrozen(transitions), true);
  }
});

test("ingest transitions move forward and fail closed for unknown or terminal states", () => {
  assert.equal(canTransitionIngest("discovered", "url_ready"), true);
  assert.equal(canTransitionIngest("fetching", "quarantined"), true);
  assert.equal(canTransitionIngest("scanning", "accepted"), true);
  assert.equal(canTransitionIngest("accepted", "deriving"), true);
  assert.equal(canTransitionIngest("deriving", "review_pending"), true);
  assert.equal(canTransitionIngest("source_expired", "url_ready"), true);
  assert.equal(canTransitionIngest("dead_letter", "fetching"), false);
  assert.equal(canTransitionIngest("rejected", "accepted"), false);
  assert.equal(canTransitionIngest("accepted", "fetching"), false);
  assert.equal(canTransitionIngest("unknown", "accepted"), false);
  assert.equal(canTransitionIngest("accepted", "unknown"), false);
  assert.equal(canTransitionIngest("accepted", "accepted"), false);
});

test("approved and published releases cannot mutate backward", () => {
  assert.equal(canTransitionRelease("draft", "review_pending"), true);
  assert.equal(canTransitionRelease("review_pending", "changes_requested"), true);
  assert.equal(canTransitionRelease("changes_requested", "revision_processing"), true);
  assert.equal(canTransitionRelease("revision_processing", "review_pending"), true);
  assert.equal(canTransitionRelease("review_pending", "approved"), true);
  assert.equal(canTransitionRelease("approved", "packaging"), true);
  assert.equal(canTransitionRelease("packaging", "ready"), true);
  assert.equal(canTransitionRelease("ready", "published"), true);
  for (const backward of ["draft", "review_pending", "changes_requested", "revision_processing"]) {
    assert.equal(canTransitionRelease("approved", backward), false);
    assert.equal(canTransitionRelease("published", backward), false);
  }
  assert.equal(canTransitionRelease("published", "superseded"), true);
  assert.equal(canTransitionRelease("published", "withdrawn"), true);
  assert.equal(canTransitionRelease("superseded", "published"), false);
  assert.equal(canTransitionRelease("withdrawn", "draft"), false);
  assert.equal(canTransitionRelease("unknown", "draft"), false);
});

test("media profiles expose only exact known capability sets", () => {
  assert.deepEqual(Object.keys(mediaProfiles).sort(), [
    "client.fullres.share.v1",
    "ontario.proptx.provisional.2026-08-11.v1",
    "original.camera.v1",
    "thumbnail.admin.320.v1",
    "web.listing.1280.v1",
    "web.listing.2048.v1",
    "web.listing.320.v1",
    "web.listing.640.v1",
  ]);
  assert.equal(profileSupports("original.camera.v1", "canonical_master"), true);
  assert.equal(profileSupports("client.fullres.share.v1", "client_download"), true);
  assert.equal(profileSupports("web.listing.1280.v1", "listing_display"), true);
  assert.equal(profileSupports("thumbnail.admin.320.v1", "admin_thumbnail"), true);
  assert.equal(profileSupports("ontario.proptx.provisional.2026-08-11.v1", "destination_export"), true);
  assert.equal(profileSupports("unknown", "client_download"), false);
  assert.equal(profileSupports("client.fullres.share.v1", "unknown"), false);
});

test("the Ontario destination profile remains explicitly provisional and dated", () => {
  const profile = getMediaProfile("ontario.proptx.provisional.2026-08-11.v1");
  assert.ok(profile);
  assert.equal(profile.status, "provisional");
  assert.equal(profile.effectiveDate, "2026-08-11");
  assert.equal(profile.label, "Provisional Ontario preset");
  assert.equal(profile.derivativeClass, "mls");
  assert.equal(isMediaProfileId(profile.id), true);
  assert.equal(isMediaProfileId("ontario.mls.universal.v1"), false);
  assert.equal(getMediaProfile("ontario.mls.universal.v1"), null);
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.capabilities), true);
});
