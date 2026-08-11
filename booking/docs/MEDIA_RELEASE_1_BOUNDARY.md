# Media Release 1 Boundary

**Status:** Approved implementation boundary; production rollout remains disabled until its human gates pass.

## Objective

Release 1 establishes Pixel-owned, immutable media and release infrastructure beside the existing delivery system. It does not replace the current business workflow during initial implementation.

The first production outcome is one exact authorized Pixel property whose completed Autoenhance outputs can be ingested, validated, stored, transformed, approved, packaged and downloaded through Pixel while every existing iGUIDE and legacy deliverable remains available as fallback.

## Default state

```text
MEDIA_V1_ENABLED=false
MEDIA_V1_SHADOW_MODE=false
MEDIA_V1_RELEASE_READS=false
MEDIA_V1_DOWNLOADS=false
```

No new path activates from configuration absence. Tenant/property allowlists are required in addition to the global flag. Unknown state fails closed to existing behavior.

## Included

1. Media-domain TypeScript state machines and transition tests
2. Additive Supabase tables for assets, versions, derivatives, jobs, profiles, releases, packages, grants and events
3. RLS/service-role boundaries with organization-qualified ownership
4. Private Cloudflare R2 quarantine, master, derivative and package object classes
5. Durable leased container-worker jobs
6. Hardened fixed-provider Autoenhance output ingestion
7. Byte, MIME, encoding, magic-byte, dimension, pixel-count and checksum validation
8. Quarantine and scan state before canonical promotion
9. Immutable master and derivative identity
10. Deterministic full-resolution and provisional Ontario derivatives
11. Immutable release manifests
12. Streamed full-resolution and MLS-profile ZIP packages
13. Opaque revocable download grants and very short-lived object-store capabilities
14. Shadow-mode reconciliation against current deliverables
15. Portal compatibility read: **release-first, legacy-fallback** only for allowlisted migrated properties
16. Synthetic and exact authorized Pixel pilot evidence
17. Operator visibility for failed jobs and mismatches

## Explicitly excluded

- No table or column drop
- No destructive column rename
- No current `deliverables` or `listing_websites` field replacement
- No historical bulk rewrite
- No automatic publication
- No public tenant enablement
- No universal MLS-compliance claim
- No realtor-gallery redesign beyond the minimum compatibility read
- No listing-page visual redesign
- No Fotello production promotion
- No Imagen, PhotoUp, Styldod, BoxBrownie, Apply Design or Restb.ai connector
- No brokerage layer
- No billing/packaging change
- No deletion or retirement of current iGUIDE, Autoenhance preview, Fotello, manual-deliverable or listing-page routes

**No existing deliverable is deleted, rewritten, or invalidated by Release 1 migration.**

## Data evolution rules

1. Add nullable/defaulted schema first.
2. Preserve existing columns and indexes.
3. New records reference existing booking/property identities; old records remain readable.
4. Write new media records only when the tenant/property flag is explicitly enabled.
5. Shadow mode may ingest synthetic or exact authorized outputs but cannot alter client-visible delivery.
6. Compatibility reads return an approved, complete release only when every required asset/package is verified; otherwise they return the current legacy view.
7. Backfill operates on exact IDs, in bounded resumable batches, with dry-run counts and post-write reconciliation.
8. Existing external links remain valid until Pixel-owned copies have been independently downloaded, decoded, checksummed, packaged and exercised.
9. Release manifests are immutable; corrections create new versions/releases.
10. Managed-object cleanup requires exact key, organization, row identity and expected checksum.
11. Database migrations are never rolled back by dropping newly added production structures while live rows may reference them; operational rollback disables reads/writes and preserves evidence.

## Production migration-history constraint

The Pixel Booking Supabase production migration ledger has previously diverged from local history. Do not use `supabase db push --include-all` or apply unrelated migrations. The Release 1 migration must be:

- one exact reviewed timestamped migration;
- checked against the live ledger without exposing credentials;
- applied transactionally;
- verified by exact schema/object checks;
- repaired only for that exact version if required;
- kept inactive until application compatibility is deployed.

## Human gates

### Cloudflare R2

A human gate is required to provide or authorize:

- account and bucket creation;
- scoped credentials that cannot administer unrelated Cloudflare resources;
- lifecycle and retention choices;
- approved custom-domain/CORS policy;
- billing visibility;
- contractual privacy/data-location review.

No credential belongs in Git, logs, tests, screenshots, documentation or Mission Control.

### Worker host

A human gate is required to select and fund the first managed container host after a Linux image passes:

- Sharp/libvips build and codec tests;
- bounded memory at 50/100/200 items;
- streamed multipart upload;
- cancellation and graceful shutdown;
- lease expiry/reclaim;
- health checks and secret injection;
- outbound-network policy;
- logs containing IDs/aggregates only.

### Production schema

A human gate is required immediately before applying the exact reviewed migration. No production schema command is bundled with application deployment.

### Pilot property

Michael or an authorized operator must identify one exact Pixel-owned/authorized booking/property and confirm the provider outputs may be copied to Pixel storage. Synthetic tests run first.

## Rollout stages

### Stage 0 — Code dark

- Schema absent or unused
- Flags false
- Existing application behavior unchanged

### Stage 1 — Synthetic shadow

- Synthetic assets only
- Private buckets
- Worker and reconciliation exercised
- No portal/listing reads

### Stage 2 — Authorized Pixel shadow

- Exact allowlisted organization/property
- Autoenhance output copied in parallel
- Counts, bytes, dimensions and checksums reconciled
- Existing delivery remains authoritative

### Stage 3 — Operator-only release

- Operator previews canonical assets and packages
- Download grant exercised on desktop and mobile
- Current realtor links remain available

### Stage 4 — Release-first pilot

- One authorized property reads approved canonical release first
- Any incomplete/error state falls back to legacy delivery
- Download and support telemetry reviewed

### Stage 5 — Narrow Pixel rollout

- Additional exact Pixel properties only after exit criteria pass
- SaaS tenants remain off

## Entry criteria for client-visible pilot

- Remote R2 upload/HEAD/GET/delete verified with synthetic exact keys
- Linux worker image verified
- Production migration reviewed and applied exactly
- Cross-tenant RLS and service-role tests pass
- Ingestion is idempotent and bounded
- Master/derivative/package checksums reconcile
- Package manifest is reproducible
- Revoked/expired grants fail
- Payment/release policy cannot be bypassed
- Legacy fallback is exercised
- Operator can see and retry failures
- No secret/provider body/PII leakage in logs
- Desktop and mobile download behavior passes

## Exit criteria

- Zero wrong-property, wrong-tenant or wrong-version escapes
- Zero false approved/released states
- Zero existing deliverables lost or invalidated
- Zero revoked grants still accepted
- All provider outputs accounted for or explicitly excepted
- Repeated package generation produces the same manifest and checksum
- Existing booking, calendar, iGUIDE, email, invoice, portal and listing-page workflows remain operational
- Rollback drill succeeds

## Rollback

Operational rollback is configuration-only:

1. Set `MEDIA_V1_RELEASE_READS=false` and `MEDIA_V1_DOWNLOADS=false`.
2. Portal/listing behavior returns to legacy reads.
3. Stop new allowlisted ingestion by setting `MEDIA_V1_SHADOW_MODE=false` or `MEDIA_V1_ENABLED=false`.
4. Let leased work settle or expire; do not delete job/asset evidence.
5. Keep additive tables and private objects intact for diagnosis.
6. Reconcile any provider/output action before retrying.
7. Existing iGUIDE, deliverable URLs, listing pages, emails and invoices remain untouched.

Rollback does not drop schema, truncate data, delete customer records, or remove current links.

## Stop conditions

Immediately disable the new path if any of these occur:

- cross-tenant access or identity ambiguity;
- output count/checksum mismatch;
- unbounded download or decompression behavior;
- provider retry could duplicate a paid mutation;
- master overwrite attempt;
- legacy fallback failure;
- wrong release/branding/profile escape;
- revoked access still works;
- unexplained object/database divergence;
- migration-ledger mismatch;
- client-visible regression in the live business workflow.

## First implementation order

1. Harden the inventory contract and known destructive writers before depending on them.
2. Add media state/type tests.
3. Add the exact additive schema and RLS behavior tests.
4. Add provider-neutral storage/ingestion interfaces.
5. Turn the local Sharp spike into a Linux container worker.
6. Verify synthetic R2 and worker operation.
7. Add Autoenhance output ingestion in shadow mode.
8. Add releases, packages and grants.
9. Add release-first, legacy-fallback portal reads.
10. Run the exact authorized Pixel pilot.

Nothing in this boundary authorizes deletion of existing business data.
