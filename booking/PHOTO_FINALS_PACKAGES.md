# Finished JPEG approval and packages — executable local slice

Extends `PHOTO_FINALS_FOUNDATION.md` and `PHOTO_FINALS_INGEST.md`. This is **not an enabled customer workflow**. New modules have no route, UI, email, scheduler or public gallery consumer. Production execution is explicitly rejected. No production schema, bucket, settings, subscription or deployment changes.

## Delivered boundary

- `20260912160000_photo_finals_packages.sql` extends canonical `gallery_releases`, `gallery_release_items`, `media_derivatives`, `media_packages` and `media_ingest_jobs`. Additional release FK and bounded append-only checkpoint JSON on the existing job; no parallel media tables.
- `prepareFinalRelease` / `photo_finals_prepare_release` create a private ordered review snapshot from exact accepted JPEG versions. Tenant/property/booking/batch checks, current non-archived admin + owner/admin membership, one version per asset, bounded file/byte/pixel counts, canonical master identity and current rights are checked in SQL. Every input identifier is a lowercase canonical UUIDv4. Exported APIs reject malformed spelling before any RPC; SQL rejects non-v4 UUID values and validates JSON selection spelling before casts/writes. PostgreSQL uuid-typed scalar arguments inherently canonicalize their input spelling; persisted values and downstream grammar remain identical. Client release UUID provides replay; changed selections conflict. Expected prior revision serializes on a tenant/batch advisory lock.
- `approveFinalRelease` / `photo_finals_approve_release` reauthorize the current actor and exact scope, lock the same revision scope and canonical release parent, reload exact items and versions, reconstruct the manifest **and its digest**, compare the expected server-issued digest/revision and reject stale selection/head revision. Item approval, immutable release approval, both package intents, and one durable package job commit atomically. Late job insertion failures roll back all approval writes. Replays never bypass current authorization.
- Corrections create another release/revision with `supersedes_release_id`; they do not rewrite or delete the old snapshot, package bytes or accepted master. This stage deliberately does not publish/supersede the old customer-facing release.
- `processFinalRelease` actually reads and verifies accepted original JPEG bytes, fully decodes with sharp, creates private gallery and MLS JPEGs, builds two real ordered ZIPs, uploads create-only and completely drains verified GETs before completion. `dispatchFinalReleases` lists and processes **one** due job per invocation, including expired-lease takeover; operator-invoked, not installed cron.
- One atomic finish validates every expected evidence element and changes all required derivative/package rows plus release readiness together. Missing, duplicate, wrong-shape or single-null evidence rolls back. A release-level ready guard requires completed job, both packages and all item derivatives. The database trusts only the service worker to attest drained object bytes; it does not contact storage itself.

## Versioned transformations

`transforms.ts` and SQL snapshot specifications are compared exactly by the worker:

| Canonical profile | Executable v1 behavior |
| --- | --- |
| `client.fullres.share.v1` | Exact original JPEG bytes in ZIP; no resize, re-encode, orientation change or metadata removal. Original EXIF remains intentionally preserved. |
| `web.listing.2048.v1` | Auto-orient, inside 2048×2048, no enlargement, sRGB, JPEG quality 82, 4:2:0, baseline/non-progressive, metadata stripped. Private storage only. |
| `ontario.proptx.provisional.2026-08-11.v1` | Same bounds, quality 90. **Provisional MLS export — verify destination requirements.** Not universal or board-certified compliance. |

JPEG encoder fingerprint: sharp `0.35.4`, libvips `8.18.6`, mozjpeg `0826579`; a different runtime fails closed. Encoder options are pinned in the immutable specification. Platform/architecture maximum-size reproducibility and runtime certification remain gates; upgrades must review a new transformation version, not silently overwrite ready derivatives.

ZIPs use deterministic ZIP32 STORE entries in selection order, fixed DOS epoch and generated `001.jpg`, `002.jpg`, etc. No user filenames or directory paths enter the archive. Full-res preserves source bytes; MLS entries equal the verified MLS derivative bytes. ZIPs stream through the same deterministic emitter twice: hash/count first, then emit 8 MiB multipart parts against that exact checksum-addressed identity. Each pass reloads and verifies one immutable source at a time; the storage adapter rehashes/recounts the emission before create-only completion. No whole-release disk/RAM spool. Per-photo source buffers, decoder working memory, bounded multipart snapshots and up to 100 central headers remain. `StoredZip` is retained only as a byte-equivalence test oracle; the worker does not call it. The maximum-input test uses a disk-backed local S3 command double, counted separately from worker scratch.

Limits remain 100 files, 32 MiB/source, 1 GiB selected original bytes, 16,384 px/side and 100M pixels/source. Worker ZIP scratch is zero; the local job has a 15-minute abort budget propagated through storage, 30-second decoder budgets, and a 30-second independent heartbeat loop renewing the 120-second SQL lease during long I/O. RPC waits have a 10-second client deadline and propagate cancellation to PostgREST when supported; SQL row/advisory lock waits have a 5-second limit. Multipart abort cleanup gets an independent 10-second signal. A transport timeout is uncertainty, not proof that SQL or storage rolled back. These are **not Vercel memory/runtime or live PostgREST certification**.

### Hash/key contracts

The new `finished_jpeg_release.v2` hash is SHA256 of UTF-8 **PostgreSQL `jsonb::text`**. Preview returns an opaque server-issued digest which approval reconstructs; do not substitute `JSON.stringify` or the historical selection.v1 fingerprint. Specs/order and immutable object identity are inside that snapshot.

Existing `R2Storage` enforces actual object SHA256 in every immutable key, including packages. Therefore package keys use `packages/{org}/{release}/{type}/{actual_zip_sha256}.zip`; `media_packages.manifest_sha256` separately binds the approved snapshot. This resolves the existing key-builder parameter's misleading `manifestSha256` name without weakening/changing the canonical storage adapter. Derivative keys retain its established grammar. No immutable object is overwritten or deleted as compensation.

## Lease/recovery contract

- One canonical package job per release, eight attempts by default, 120-second leases and token rotation on expiry. Shared canonical attempt rows retain settled/expired outcomes.
- Claims are exact tenant/booking/property scoped. Heartbeats, completion and failure require current actor, packaging release, exact token and unexpired lease. Completion rechecks the fence after all writes so expiry during the transaction rolls everything back.
- Each verified gallery/MLS transform appends one validated, lease-fenced checkpoint to the job. Append-only guards bind exact selected version/kind/key/hash/size/dimensions; replay must be identical. Checkpoints do not mark any derivative or package ready. Resume verifies stored bytes again and skips completed transforms; atomic finish still publishes all package/gallery readiness together.
- A crash/partial package failure leaves the release unavailable and its immutable objects retained. Archive passes restart from bounded immutable sources; existing/ambiguous writes succeed only after matching complete GET verification. No generic deletion capability or fake cleanup success.
- Last-attempt failure and expired exhausted claims become `dead_letter`. Revoked-actor work fails closed and needs an operator policy; there is no claim of automated revoked-actor reconciliation.
- A dispatched object-store request cannot be atomically cancelled by PostgreSQL. A late worker may create immutable residue but cannot publish readiness under a stale lease. A lost completion response is reported as unconfirmed; the canonical completed job remains authoritative, and later dispatch does not redo it.

## Reproduce

From `booking`, Node 24 and local PostgreSQL 17:

```sh
npm run test:photo-finals
npm run test:postgres:finals-packages
npm run test:postgres:finals-resource
npm run test:postgres:finals-long-io
npm run test:postgres:finals-ingest
npm run test:postgres:photo-finals
LC_ALL=C TMPDIR=/tmp npm run test:postgres:media
npm test
npm run typecheck
npm run lint
npm run build
```

The new runner starts a disposable Unix-socket-only PG17 cluster and tears it down before printing success. Actual SQL functions execute as `service_role`; storage is the real `R2Storage` using a **test-only local command adapter**, not live R2 or PostgREST transport. Python's independent ZIP parser verifies CRC, entry names/order and exact extracted content hashes. Tests cover actual JPEG bounds/orientation/metadata, 48 missing/malformed evidence rollback probes, expiry during completion, stale-token fencing/takeover/exhaustion, partial MLS failure with retained full ZIP, ambiguous completion, correction immutability, authorization/replay and forced late approval rollback. Four two-session races require an observed `Lock` wait and blocker: both approval/item-write orderings, approval replay and lease claim.

## Local verification checkpoint

Final local gates passed: **611 repository tests, 14 focused finals tests, TypeScript, ESLint, production build, package PG17 integration, maximum-input and 125-second-I/O probes, plus existing ingest, approval-concurrency and canonical-media PostgreSQL suites**. Independent review and deployed execution remain separate gates.

Identifier failure was reproduced before fixing with the cited independent review script: non-v4 release approved into packaging, then deterministic worker rejection/retryable attempt. Current integration exercises exported preparation → actual PG17 approval → worker and no-write identifier rejection, checkpoint replay/malformed/stale-token rejection, zero transform PUTs on resume, real ZIP CRC/order/content, atomic readiness, and five observed-lock probes including a server-side lock timeout.

Measured local maximum-input run (`test:postgres:finals-resource`): **100 real JPEGs, 1,073,741,824 original bytes, 33,554,432 maximum source bytes, one 100,000,000-pixel input**. Packaging 32,982 ms; ingestion plus packaging/checks 48,572 ms. Sampled peak RSS 1,271,955,456 bytes; process max RSS 1,242,512 KiB; sampled external memory 214,525,121 bytes. Worker scratch 0 bytes; separate test-backend peak disk 3,225,047,466 bytes (quarantine + masters + immutable outputs). Full ZIP 1,073,750,846 bytes and MLS ZIP 1,277,011 bytes; both 100 entries with independently verified CRC/order/extracted hashes. These synthetic solid-colour/comment-padded JPEGs exercise byte/count limits and maximum decoded pixel count, **not worst-case photographic entropy, every decoder allocation or production concurrency**.

Measured local long-I/O run delayed an actual adapter UploadPart command **125,000 ms**, exceeding the actual 120-second SQL lease; six heartbeat calls were observed during/after upload, the lease remained live, and completion succeeded. Separate budget-timeout and stale-owner runs aborted I/O, retained zero incomplete uploads and recovered through a new invocation. Local command doubles are not live provider latency/cancellation certification. Existing Node typeless-package and Next middleware-deprecation warnings remain.

## Scope delta and remaining gates

No ingest migration, ingest worker or ingest fixtures edits. Storage adapter delta is only an independent 10-second multipart-cleanup abort signal. The additive migration replaces the canonical job transition trigger function only to recognize the new package job lifecycle; the original ingest branch/rules are preserved. Shared type declarations and generated setup SQL include the additive schema. Existing ingest and canonical suites must remain green.

1. Independent exact-candidate security/database review (standalone Codex CLI unavailable on this host). Local execution is evidence, not independent approval.
2. Browser upload, review/order/approval routes and UI; authorized private gallery/download readers; current rights/withdrawal/access handling; operator/realtor responsive E2E. **These remain the next stage.**
3. Integration with the shared source selector: valid iGUIDE remains authoritative per photo slot, including transient fetch failure; complete Pixel only fills missing slots. No source-selector, video, billing or send-time behavior changed here.
4. Exact reviewed canonical + ingest + package migration rollout after production ledger/schema/backup review; no remote migration was applied.
5. Approved private production storage/bucket dedication, credentials, CORS, retention and create-only browser capabilities; actual isolated provider and PostgREST transport probes.
6. Existing Vercel Node is only a candidate. Certify maximum JPEG memory (local measured peak exceeds 1.2 GB), architecture/encoder reproducibility, function deadline, real DB/storage timeout and cancellation behavior, concurrency and authenticated scheduling through a deployed probe. Zero ZIP scratch and resumable transform checkpoints remove the former spool/restart gaps but do not establish deployed capacity. No new paid service is assumed.
7. Immutable residue/quarantine reconciliation, revoked-actor/dead-letter operator controls, release quotas, destination-specific MLS approval, kill-switch and exact allowlist review before enablement.
