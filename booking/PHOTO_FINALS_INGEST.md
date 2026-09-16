# Finished JPEG ingest: executable local acceptance slice

This extends `PHOTO_FINALS_FOUNDATION.md`; it does not ship the upload-to-gallery product. No application route imports the new worker. **Production execution is explicitly rejected**, even with the foundation's production eligibility flags. Development R2 factory protections are unchanged.

## Implemented

- Additive `20260912120000_photo_finals_ingest.sql` extends **existing canonical jobs**, not a parallel asset model. Requires the canonical foundation migration first (known absent in production at the prior read-only inventory).
- `photo_finals_create_intent`: current non-archived tenant admin + owner/admin membership, exact booking/property ownership, same request/file replay, immutable declared checksum/size/quarantine identity, atomic batch/asset/version/job creation. Browser roles cannot execute RPCs or mutate canonical tables.
- Tenant-serialized durable quotas: 32 unresolved intents, 200 preparations/hour, 100 files and 1 GiB per batch, 32 MiB per file. Replays precede quota checks but never bypass current authorization. Terminal rows remain for audit/rate accounting.
- Organization/hash reservations reject **every other intent**, including same-booking duplicates and cross-booking duplicates, with `finals_hash_collision_other_intent_or_booking` / SQLSTATE 23505. Same-intent retries keep original version and object identities. Organization-wide accepted-hash uniqueness is unchanged. Reservations are retained even after rejection; an explicit reviewed operator reconciliation policy is needed before releasing them.
- Fixed 120-second leases, token rotation on expiry, eight-attempt default, append-only settled/expired attempt evidence, 24-hour upload-intent deadline, atomic terminalization, expiry and token fencing on target authorization, acceptance and failure settlement. No storage work occurs without a claimed job.
- `lib/media/finals/ingest.ts`: actual SHA256 and byte count, JPEG signatures, sharp/libvips full decode (`stats`, not metadata-only), 100M input pixels, 16,384/side, strict warning rejection, 30-second decoder timeout. Preserves exact original JPEG bytes; does **not** sanitize EXIF, establish rights, or claim antivirus scanning. Canonical phase checkpoints are committed around actual work: verified read → quarantined; metadata validation → validating; full JPEG pixel decode → scanning. Reclaimed leases repeat validation without moving those states backwards. These are not antivirus service claims.
- Existing `R2Storage` verified streams and atomic create-only writes perform private quarantine → immutable master acceptance. Final bucket identity comes from the adapter, not caller metadata. Every master is completely GET-verified before database acceptance. Ambiguous PUTs and crash-after-promotion retries reuse/verify exact immutable identity; never delete a master as compensation.
- `dispatchFinalIntents` obtains a DB-backed exact-scope due list (maximum two) and processes files sequentially. It is operator-invoked, not an installed scheduler. Each file gets a 90-second storage abort budget; no whole-shoot or raw-pixel JS buffer. This budget excludes unbounded database transport waits and is **not production runtime/memory certification**.

The database fence cannot atomically cancel an already-dispatched object-store PUT. A late request may only create the same reserved immutable key/bytes; stale acceptance is rejected. Quarantine identities remain durably recorded and objects are intentionally retained in this slice. Exact-ETag cleanup, expiration/capability race handling, retention policy and operator reconciliation are release gates, not silently successful cleanup.

## Reproduce actual local proof

From `booking` with Node 24 and PostgreSQL 17 installed:

```sh
npm run test:photo-finals
npm run test:postgres:finals-ingest
npm run test:postgres:photo-finals
LC_ALL=C TMPDIR=/tmp npm run test:postgres:media
npm test
npm run typecheck
npm run lint
npm run build
```

The new runner creates a disposable Unix-socket-only PostgreSQL cluster under `/tmp`, applies exact canonical + ingest SQL, then tears it down before emitting aggregate success. `POSTGRES_BIN` may select a local PostgreSQL 17 directory; no external database URL is accepted.

Proofs include forced late-insert transaction rollback; actor/tenant/replay denial; null dimension rejection; duplicate claim; expired/stale-token fencing; attempt exhaustion; expired upload terminalization; three two-session races with **observed `Lock` waits** (same-intent reuse, cross-booking same-hash collision, quota boundary). Real generated JPEG bytes traverse the actual worker and actual SQL RPC functions, including ambiguous PUT recovery, crash-after-promotion takeover, invalid/PNG rejection and bounded dispatch.

Storage uses a clearly named **test-only local in-memory S3 command adapter** behind the real `R2Storage`. This is not live R2, a private-bucket configuration test, browser upload, or PostgREST transport proof. No customer media, remote schema/bucket changes, purchases, subscriptions or production enablement occur.

## Verification checkpoint

The final local candidate passed 607 repository tests, the 10 focused finals tests, both existing PostgreSQL suites, the new transactional/concurrency/storage suite, TypeScript, ESLint and the production build. The new integration suite also reclaims crashes at quarantined, validating and scanning phases. Existing Node typeless-package warnings remain.

Independent review was attempted through the installed Claude CLI, but its provider returned HTTP 401 (`OAuth access token is invalid`); no independent approval was obtained. This commit is a local tested checkpoint only. An authenticated independent review remains mandatory before release.

## Remaining end-to-end gates

1. Independent exact-candidate review; production schema/ledger compatibility and approved exact canonical + ingest migration rollout (never broad migration push).
2. Private production adapter, dedicated-prefix/occupancy/credential review, exact CORS and create-only direct-upload capability issuance with durable size/hash headers. Browser upload/completion routes and authorization are not implemented here.
3. Quarantine cleanup/reconciliation with lease/ETag/capability-expiry fencing; stalled/revoked actor and legacy accepted-hash collision operator paths. Retained immutable residue is evidence, not automatically reclaimed storage.
4. Existing Vercel Node hosting is a candidate: measure peak memory and runtime for maximum-size/maximum-pixel JPEGs, add DB transport timeouts and authenticated bounded scheduling within its actual budget. No new paid Cloudflare service is assumed or purchased.
5. PostgREST/client transport contract integration, actual isolated live storage probe, production allowlist and kill-switch review.
6. Rights/disclosure selection, approval transaction, transforms, ZIPs, private gallery/downloads, operator/realtor UI and responsive end-to-end delivery verification remain parent-owned. Preserve iGUIDE-first selection, independent video, and all billing/delivery rules.
