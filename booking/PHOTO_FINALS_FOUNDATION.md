# Finished JPEGs: code-dark selection foundation (not the complete release slice)

Candidate base: `fda144090a12c4abc462eea394dc26a785f0ad71` (`origin/main`).

## Delivered / intentionally unavailable

- `lib/media/finals/config.ts`: pure configuration eligibility, with literal opt-in, separate production and isolated-local modes, exact organization/booking/property tuples, bounded configuration, no wildcard/cross-product allowlists. **Eligibility is not authorization, a configured production storage adapter, or permission to upload.** There are no route consumers; setting these variables does not activate a workflow.
- `lib/media/finals/manifest.ts`: pure, private **selection** fingerprint over projections of the existing canonical `media_batches` and `media_versions` rows. Validates scope, exact selected identity set, one version per asset, complete accepted JPEG metadata, current rights and canonical master key binding. Pins order and generated safe ZIP-entry names; deep-frozen output is detached from input rows. This neither decodes/verifies bytes nor approves/enqueues/publishes anything.
- `scripts/verify-photo-finals-concurrency.py`: disposable PostgreSQL 17 tests of the **existing** canonical release parent-lock protocol in both approval/item-insert orderings. Both mutations run as `service_role`; an observer must see `wait_event_type='Lock'` and a blocker before releasing the holder. Requires exact SQLSTATE/message and final state/count. No network listener; synthetic database fixtures only.

No new media tables, RPCs, storage factories, route/UI consumers, schedulers, email/billing gates, or migration changes. Development-only R2 protection remains unchanged. iGUIDE-first selection and all existing workflows remain unchanged.

## Configuration contract

`PHOTO_FINALS_ENABLED=true` is necessary but not sufficient for eligibility. Other values are disabled.

Production eligibility requires `PHOTO_FINALS_ENVIRONMENT=production` and `VERCEL_ENV=production`. It does not load credentials or declare storage readiness. A **separate reviewed production storage factory**, private resources/roles/retention and exact browser CORS are still required. Do not repurpose `loadDevelopmentMediaStorageConfig` or its synthetic bucket.

Local tests require `PHOTO_FINALS_ENVIRONMENT=synthetic-local`, `NODE_ENV=test` or `development`, no `VERCEL_ENV`, and `PHOTO_FINALS_SYNTHETIC_ACK=isolated-no-network`. This is a declared test-mode restriction, not an OS network sandbox.

`PHOTO_FINALS_ALLOWED_SCOPES` is JSON containing 1–100 exact objects with only `organizationId`, `bookingId`, `propertyId`, each a lowercase UUID v4. Duplicate tuples, wildcards, unknown keys, malformed values and oversized configuration fail closed. Do not infer allowlist membership from separate lists, organization names, default identity, or failed reads.

## Selection manifest contract

The returned manifest is **private server data**, not a browser DTO: it includes immutable storage identity. Its kind is `finished_jpeg_selection.v1`, not an approval receipt or final packaging contract. Bounds are 100 selected files, 32 MiB/file, 1 GiB aggregate, 16,384 pixels/side and 100 million pixels/image. These are foundation limits, not proof a future worker can process them within its budget; worker/SQL/UI limits must agree before rollout.

Input rows are exact canonical projections, with Supabase bytea represented as `\\x` plus lowercase SHA256 hex. `selectedVersionIds` defines order; database return order does not. Every selected row must belong to the same organization/property/batch, and the batch must match the exact booking. Master keys are rebuilt using the canonical storage grammar and compared exactly, including asset/version/digest/extension. Filenames are generated `001.jpg`, `002.jpg`, etc., not supplied by users. Rights must currently permit use; future readers must recheck rights/revocation.

Hash contract: SHA256 of UTF-8 `canonicalJson`, whose object-field order is defined by the builder and whose item array follows selection order. **Do not hash `jsonb::text` as an equivalent encoding.** A future SQL approval function must independently construct/validate the identical canonical format, or introduce a separately versioned format with cross-runtime golden vectors. It must never trust a caller's manifest or digest alone.

## Full transaction architecture / remaining acceptance gates

1. Current operator authorization, then exact tenant/property/booking eligibility. Service-role readers/writers must revalidate canonical ownership. Browser roles remain unable to write canonical tables.
2. One tenant/booking-locked upload transaction creates bounded/idempotent batch, asset, version and durable ingest intent before any external allocation. Manual provenance: `source_provider=manual_finals`, `provider_connection_key=manual_finals.v1`, job identity=request UUID and output identity=file intent UUID. No editor dependency or editing-provider call.
3. Private browser-to-quarantine upload. Browser completion is only advisory. Durable worker claims one lease, caps streams/decoder/pixels/deadlines, validates JPEG bytes/checksum, reserves identity, promotes create-only using existing storage, then atomically records acceptance and evidence under the exact unexpired lease. Recover ambiguous promotion by verified identity; never delete immutable masters as compensation.
4. **Resolve dedup semantics first:** canonical accepted hashes are unique across an organization, but release references are property/batch-bound. Reusing a same-hash version from another booking violates ownership structure. Select explicit bounded collision rejection or review a canonical source/reference extension; no hidden second media model. Same-request retry must still reuse its original intent.
5. Atomic approval locks draft/release and children, rechecks current actor and expected draft revision/selection fingerprint, pins exact versions/order/rights/disclosure and executable transform specifications, approves items and enqueues bounded package/derivative work together. This selection helper is not that transaction. Corrections create another release; exclusion is not deletion.
6. Existing profiles currently define names/capabilities, not full executable encoder/resize/metadata rules. Review versioned full-res/MLS/gallery transformations first. MLS labeling remains provisional. Full-res and MLS ZIPs and all gallery derivatives must verify against the same approved snapshot before any Pixel availability claim.
7. Durable workers need claim/finish RPCs, attempts, deadlines, expired-token fencing, takeover, crash recovery, ambiguity reconciliation and a real bounded dispatcher. Existing ingest jobs do not by themselves constitute an implemented package worker. Worker hosting/resource costs remain a separate approval gate.
8. One authorized current-state canonical reader/private gallery/download boundary for operator and realtor. Never expose storage keys or drafts. Deny expired/revoked/withdrawn/wrong-owner access. Feed complete candidates into the existing shared source selector in operator preview, realtor portal and fresh send-time resolution. Valid iGUIDE wins per slot even during transient network errors; complete Pixel fills only missing slots. No broad send gate, billing regression, automatic email or photo-triggered booking/video completion.
9. Real upload/select/order/approve/gallery/download component/browser interactions at 320/390/768/1440, security/concurrency tests of the **new** RPCs and workers, independent exact-candidate review. No UI/E2E/real JPEG/ZIP/provider/storage-success claim from this foundation's synthetic metadata fixtures.
10. Parent-owned read-only production schema/ledger/config inventory; exact reviewed additive migration only if needed. Never broad include-all/repair-all. Production resource creation, credentials, CORS, schema apply, worker setup and allowlist enablement remain separate approved rollout steps.

Out of scope: RAW, editing-provider integrations, public listing-site migration, historical backfill, video lifecycle, billing and global delivery-completion rules.

## Reproducible local verification

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run test:photo-finals
npm run test:postgres:photo-finals
LC_ALL=C TMPDIR=/tmp npm run test:postgres:media
npm test
npm run typecheck
npm run lint
npm run build
```

Node 24 and PostgreSQL 17 were used. The existing PostgreSQL runner required `LC_ALL=C` on this macOS host (without it PostgreSQL reported multithreaded startup); the new runner sets it explicitly and prints success only after teardown. `POSTGRES_BIN` can select a local PostgreSQL 17 binary directory, never a remote database.

Actual candidate gates: 602 repository tests passed; focused selection/config tests passed; existing canonical PostgreSQL behavior/rollback suite passed; new observed-lock two-ordering suite passed; TypeScript, ESLint and production build passed. These establish a tested **foundation**, not completion of the requested upload-to-gallery product. Node emits the repository's existing typeless-package warning. No push, merge, deploy, production mutation, schema apply, credential change or purchase occurred.
