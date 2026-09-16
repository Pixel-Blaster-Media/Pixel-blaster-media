# Production adapters — locally executable, NOT activated or certified

This supersedes the nonactivating-factory statements in the older PHOTO_FINALS documents. Base candidate: `b1bf5c8e62ddbaea1ee356acc429a8e439d131de`. No remote schema, resource, credentials, environment, deployment or customer-data mutation is part of this change.

## Implemented

- The server-only production factory constructs `FinalsR2Storage`, a finals-only restriction of the existing `R2Storage`, with the AWS S3 SDK, virtual-host R2 addressing, region `auto`, one request attempt, 5-second connection and 10-second request/socket limits. No development factory, development credential or synthetic bucket is reused. Immutable writes, tenant key parsing, multipart abort cleanup and independently verified reads remain unchanged. Quarantine deletion always rejects locally with `finals_quarantine_delete_uncertified`; the shared/legacy adapter is unchanged.
- A separate full production configuration gate is used by application, ingest and package execution. Existing synthetic-local and development storage guards are unchanged. Every exact organization/booking/property tuple still requires the existing bounded scope allowlist; SQL independently authorizes current actors and ownership.
- The actual Supabase SDK uses a fixed-origin, POST/RPC-only transport: closed operation list, 256 KiB request cap, 2 MiB declared AND streamed response cap, no redirects or automatic retries, identity encoding, JSON MIME and a 10-second headers/body deadline. Cancellation crosses the application wrapper into PostgREST. Documented SQL `void` operations accept HTTP 204; object/JSON operations cannot silently accept 204. Timeouts are unconfirmed outcomes, not proof of rollback.
- The presigner freshly reads the durable authorized upload target, never trusts supplied key/hash/size fields, and binds one tenant/job quarantine key, exact positive size up to 32 MiB, SHA256 checksum and metadata, JPEG Content-Type, `If-None-Match: *`, and at most 60 seconds (also bounded by durable intent expiry). Browser JavaScript supplies the returned headers; the browser derives the signed Content-Length from the exact Blob. No POST-policy size range or browser-set Content-Length is claimed.
- Acceptance still independently GETs/counts/hashes/decodes the JPEG, promotes create-only and rechecks the current durable lease/authority in SQL. Upload success, checksum metadata and HTTP HEAD are not acceptance.

## Disabled configuration contract (names only; do not activate before probes)

All are required for production runtime eligibility:

- `PHOTO_FINALS_ENABLED=true`, `PHOTO_FINALS_ENVIRONMENT=production`, `VERCEL_ENV=production`.
- `PHOTO_FINALS_ALLOWED_SCOPES`: existing JSON array of exact `{organizationId,bookingId,propertyId}` tuples.
- `PHOTO_FINALS_PRODUCTION_ACK=private-resources-schema-runtime-certified-v1`: operator attestation AFTER external certification, not machine evidence.
- `PHOTO_FINALS_R2_ACCOUNT_ID`, `PHOTO_FINALS_R2_ACCESS_KEY_ID`, `PHOTO_FINALS_R2_SECRET_ACCESS_KEY`.
- `PHOTO_FINALS_R2_BUCKET`, independently included in `PHOTO_FINALS_PRIVATE_BUCKET_ALLOWLIST` (bounded JSON array, no duplicates/wildcards/dev/synthetic/public names). Bucket naming is NOT proof of privacy or dedication. No default production bucket is selected; `pixel-blaster-private-media` remains uncertified.
- Existing `NEXT_PUBLIC_SUPABASE_URL` (exact HTTPS hosted-project origin) and `SUPABASE_SERVICE_ROLE_KEY`. Custom Supabase domains/self-hosted endpoints are deliberately unsupported here.

The shared existing `/api/cron/integration-outbox` schedule optionally joins finals work without another cron entry or paid runtime. It preserves existing behavior when disabled. The manual `/api/cron/photo-finals` route is NOT separately scheduled. Both finals paths require a matching configured Bearer `CRON_SECRET` of at least 32 characters. Dispatch also requires literal `PHOTO_FINALS_DISPATCH_ENABLED=true`, `PHOTO_FINALS_DISPATCH_SCOPE` (one exact allowlisted scope), and `PHOTO_FINALS_DISPATCH_ACTOR_ID` (current authorized operator). It processes at most one due package for that scope, not an unbounded tenant scan. Finals failures are reported without losing the already-executed outbox outcome.

Shared cron retains `maxDuration=60`: absolute 30-second DB cancellation, 10-second package work budget, bounded lease join and independent 10-second multipart cleanup. Transform checkpoints can advance across invocations; a ZIP that cannot complete in this short budget needs the longer authorized operator route. The photo-finals route declares `maxDuration=300`, with a 240-second package work budget plus bounded claim/settlement. These are explicit requested budgets, NOT deployed capacity certification. Automatic ingestion retries, revoked-actor/dead-letter disposition and quarantine garbage collection are not newly implemented by this package dispatcher; existing completion/recovery/operator paths remain authoritative.

## Capability and revocation limits

S3 presigned PUTs are reusable bearer capabilities, **not one-use app tokens**. Current SQL authorization is checked at issuance and acceptance, not by R2 on every PUT. Revocation/kill switch stops new issuance and application acceptance; an already-issued URL can still create its exact quarantine object until expiry. A request admitted before expiry may finish later. Create-only prevents replacement while that object exists, but deleting it early could permit another PUT with the same still-valid capability. URL expiry or an application timeout alone does not establish in-flight-write quiescence. Credential revocation has broader blast radius and provider propagation; it is not an instantaneous per-URL revoke API.

The production sentinel failed the wrong-ETag deletion gate. Finals therefore exposes no usable quarantine-delete capability. The existing ingest worker never deletes quarantine: verified master acceptance remains independent of reclamation, and the durable intent retains its exact immutable quarantine key. The truthful disposition is **quarantine retained / cleanup not attempted**, not cleaned, expired or durably retired. No cleanup-success field or retention deadline is invented here. Bounded retention, cost/privacy limits, terminal retirement and any separate expiry mechanism still need explicit authorization and safety review before activation. This patch sets no TTL, adds no lifecycle rule or unconditional deletion, and does not certify the failed sentinel or production readiness.

Official provider references: [presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/). The latter documents conditional PutObject and distinguishes FULL_OBJECT from COMPOSITE checksum types. Local SigV4 tests do NOT establish R2's exact single-PUT SHA256 validation behavior. If the exact signed SHA256/header contract is unsupported, rollout remains blocked; there is no checksum/create-only fallback.

## Executable local proof

`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, existing ingest/package/HTTP PostgreSQL gates, and `npm run test:postgres:finals-postgrest`.

New unit contracts send actual AWS SDK-generated SigV4 URLs over loopback HTTP and independently recompute signatures. They reject changed keys, headers, bytes, length, expiry and duplicate create-only PUTs; they explicitly demonstrate that DB revocation does not revoke an existing URL. Real Supabase SDK traffic crosses loopback HTTP for 204/JSON, redirect/error/MIME/encoding/declared/streamed overflow, stalls and cancellation tests. These servers are explicit protocol doubles.

The PostgREST gate starts actual local PostgREST with a disposable Unix-socket PG17 cluster and synthetic JWT, then runs the existing real application handlers, JPEG approval/package/gallery/grant tests and Chromium/Next navigation fixture through the real SDK/HTTP/PostgREST/SQL path. A real 204 response exposed and fixed an initial adapter mismatch. Only the fixed test-origin bridge, synthetic session boundary and private storage double are substituted. All child processes are joined/stopped before success. Install local `postgrest` separately; never point this runner at a remote database.

## Verified local checkpoint

621 repository tests, TypeScript, ESLint and production build passed. Actual PostgREST/PG/browser/Next integration passed with **586 HTTP RPC responses** (282 HTTP 200, 296 HTTP 204, plus the expected adversarial 400/403/500 responses). Existing ingest, package, approval-concurrency and canonical-media PostgreSQL gates passed, as did the maximum-input resource probe and the actual 125-second long-I/O lease-renewal probe. Logs: `/tmp/pf-production-*-final.log`. Independent candidate approval is parent-owned and not claimed here.

## External readiness checklist — all remain required

- [ ] Independent exact-candidate review; production ledger/table/schema compatibility, backups and individually approved exact migration application. No broad push/repair.
- [ ] Verify selected bucket ownership/purpose/occupancy, private r2.dev/custom-domain state, scoped credentials, retention and incomplete-multipart lifecycle. Existing bucket existence is insufficient.
- [ ] Authorized isolated R2 probe: exact browser-origin CORS preflight/PUT including `content-type`, `if-none-match`, `x-amz-checksum-sha256`, `x-amz-meta-sha256`; actual Content-Length signing; wrong-byte/size/checksum denial; duplicate PUT; expiry; verified GET/promotion; multipart abort and conditional synthetic residue cleanup. Do not use customer photos or repurpose the development bucket.
- [ ] Hosted Supabase/PostgREST/TLS and real production authentication/route probes, permission denial, lock/deadline cancellation and ambiguous commit recovery. Local PostgREST version is not proof of the hosted version/configuration.
- [ ] Vercel production deployment: encoder fingerprint, actual function ceilings, high-entropy maximum-size/max-pixel memory and concurrency, same-job overlapping dispatch, long I/O lease renewal, cancellation, checkpoint recovery and large ZIP completion. No default hosting capacity claim; 10-second scheduled work may only advance checkpoints.
- [ ] Approved quarantine/revoked-actor/dead-letter operational disposition, scope/kill-switch rehearsal, destination-specific MLS approval, physical Safari upload/download and deployed end-to-end verification.

## Isolated one-shot operator storage smoke (local candidate; not deployed)

This is a separate, disabled-by-default prerequisite at `POST /api/photo-finals/operator-smoke`. It does not call the normal finals factory, provision Auth, seed media, invoke RPC/dispatch, or mutate bookings/outbox/calendar/invoices/email/push. It leaves all existing finals flags and the production ACK contract above unchanged. No smoke result earns the ACK or certifies resumable finals, publisher lifecycle, maximum workloads or physical phones.

### Server admission (names and formats only)

Nothing below is an instruction to activate this local candidate. Independent exact-candidate review and separately authorized deployment/run are required first. Use one separately admitted EXISTING operator/session, account and private bucket. No existing account, bucket privacy, allowance or operator has been remotely checked by this implementation.

- Unset `PHOTO_FINALS_OPERATOR_SMOKE_ENABLED` means 404 before constructing Supabase or storage clients. Only literal `1` arms this isolated handler. Do not set normal finals flags or fake `PHOTO_FINALS_PRODUCTION_ACK`.
- `PHOTO_FINALS_SMOKE_RESOURCE` is a strict JSON object with exactly these string fields: `accountId` (32 lowercase hex), `bucket` (one exact DNS-label bucket), `endpoint` (exact `https://<accountId>.r2.cloudflarestorage.com`), `privateAccess` (`verified-private-no-public-domains`), `retentionUntil` (canonical ISO UTC timestamp), `allowance` (`one-run-3-class-a-2-class-b-132096-upload-bytes`). This is separate operator admission of verified private access, explicit retained residue and bounded allowance; it is NOT remotely verified by the code and does not claim a dollar ceiling. Provider billing rounding/account-wide usage must be covered by the separately authorized allowance.
- `PHOTO_FINALS_SMOKE_ADMISSION` has exactly these string fields: `version` (`non-certifying-storage-smoke-v1`), `issuedAt`, `expiresAt` (canonical ISO UTC, maximum ten-minute interval, currently valid), canonical lowercase UUIDv4 `runId`, `actorId`, `organizationId`, exact HTTPS `origin` (no path, credentials or nondefault port), `claimKey`, `objectKey`, and `resourceSha256` (SHA256 of the EXACT UTF-8 resource JSON environment string). Resource retention must extend beyond admission expiry and be no more than 30 days after issue. Choose and independently approve an actual retention/disposition plan before populating this admission; the code creates no lifecycle rule.
- Exact keys must be registered as `operator-smoke/v1/<organizationId>/<runId>/claim.json` and `operator-smoke/v1/<organizationId>/<runId>/payload.bin`. Neither client nor session can select keys, endpoint, bucket, byte size, role or SQL. The singular resource record and its admission digest are the complete endpoint/resource allowlist, not a wildcard or caller-controlled destination. Supply only the independently admitted existing account/bucket.
- `PHOTO_FINALS_SMOKE_R2_ACCESS_KEY_ID` and `PHOTO_FINALS_SMOKE_R2_SECRET_ACCESS_KEY` are separate least-privilege runtime credentials, never supplied in a request, report or journal. The handler only exposes PUT/HEAD/one Range GET. Do not widen credentials or runtime powers to LIST, DELETE, multipart or administration for cleanup. Existing Supabase cookie/session verification is reused; no service-role or new Auth user is needed.

The request is same-origin POST with zero bytes (including actual Next empty-body streams), no query. Unknown body bytes are rejected before Auth. Origin/config/expiry/credential-format rejection occurs before any provider client; authoritative session verification plus a fresh nonarchived `admin` profile and privileged organization membership precede storage. Exact actor and organization must match the server admission. Existing session security, including possible normal session refresh, remains authoritative; no bypass token is added. The 15-second overall deadline includes body, Auth, membership and storage, clipped by admission expiry; the Node route requests 20 seconds. Each storage wire request also has a five-second total deadline.

### Exact finite protocol and retained residue

One invocation can send only this sequence, with no retries/fallback:

1. Create-only claim PUT (at most 1,024 bytes). The fixed claim registers run/operator/org/object/hash before the payload write. A 412 claim collision stops with `stop-consumed`; every ambiguous outcome stops. No reset/re-arm path exists.
2. Create-only PUT of one deterministic 65,536-byte body (`byte[i] = i % 251`).
3. Identical duplicate create-only PUT, which MUST return explicit PreconditionFailed/412. Acceptance or any other response stops.
4. Exact HEAD: status, ETag, byte count, MIME and SHA256 metadata must match.
5. Exactly one `bytes=1024-2047` GET, conditional on the observed ETag. Require 206, exact Content-Range, length, ETag, MIME, digest metadata, actual 1,024 bytes and independent deterministic slice SHA256.

Budget includes claim overhead and duplicate upload: at most 3 Class A attempts + 2 Class B attempts, 132,096 uploaded object-body bytes, two retained objects totaling at most 66,560 bytes, and one 1,024-byte range. Signed transport is pinned to the sole admitted virtual-host endpoint/path/method sequence. Redirects are refused, SDK attempts=1, response headers <=8 KiB; PUT/error bodies <=2 KiB each, HEAD body zero, Range body <=1 KiB before SDK parsing. TLS/HTTP/signing overhead and authenticated profile/session reads are not object-body byte accounting. Auth/data reads use the existing session client under the absolute deadline; the new bounded signed transport is specifically the storage boundary.

A retained atomic create-only claim fences concurrent/replayed payload work across instances. A losing/replayed invocation still incurs its single rejected claim request; this is not a generalized account-wide traffic governor or protection against arbitrary repeated calls by the admitted operator. The approved operational protocol is ONE driver request. After any ambiguity (including a lost claim response), STOP; do not rerun, replace the journal, change run ID, delete the claim, extend expiry or re-arm. A missing response does not establish absence/rollback. Operator non-retry discipline is necessary when even the first claim may not have reached storage.

Never delete either key in this route. Both exact registered keys must be retained as possible residue even after failure. Disable/remove the smoke enable flag, admission/resource records and separate smoke credentials after the authorized observation; preserve evidence and registered keys for the separately admitted retention/disposition process. Configuration removal does not prove in-flight quiescence or cleanup. Do not expire/remove the claim while its admission can still be used. No successful cleanup or actual lifecycle expiry is claimed.

### One-request protected driver

Default local-only diagnostic (canonical absolute path to a fresh journal inside an existing owner-only 0700 directory):

`node scripts/verify-photo-finals-operator-smoke.mjs --journal /absolute/private-dir/new-journal.jsonl --local-origin http://127.0.0.1:3000`

Local mode only accepts literal loopback, never loads dotenv or session credentials, and may observe the actual disabled route. It is not a synthetic-local override of hosted configuration. Journal creation is exclusive 0600/no-follow; the initial record and directory entry are synced BEFORE the single request. Reuse refuses. Responses are bounded to 2 KiB, redirects are refused, the driver deadline is 20 seconds, and failures leave a permanent STOP journal without retry or upstream error/credential output.

A FUTURE separately authorized hosted run uses explicit `--hosted --authorization-file /absolute/private/authorization.json --cookie-file /absolute/private/session.txt --journal /absolute/private/new-journal.jsonl`. Hosted origin is pinned to `https://pixelblastermedia.com`, not a caller URL. The owner-only 0600 authorization file must be `{ "authorization": "separately-authorized-one-shot-hosted-smoke-v1", "admission": <exact server admission object> }`, current and independently approved. The separate 0600 session file contains the admitted existing operator's Cookie header value only, no newline; never put this in chat, source or CLI arguments. This local candidate run does not acquire or use such a session. The driver copies only nonsecret registration into the protected journal, never the session value or R2 credentials. Any other environment/origin requires new review, not ad-hoc flags.

Tests execute the real handler, Next request adapter, route session wiring and native AWS SDK signed transport using explicit loopback/storage/Auth doubles. Two separate Node processes contend over the existing LocalS3 fixture; the claim survives handler/process identity changes. These are local protocol tests, NOT evidence that R2/Vercel/Auth actually honored the contract. No shared fixture file, normal finals guard, schema or booking handler is changed.

Future full authenticated finals lifecycle/phone testing and full-index egress optimization remain separate. This tiny smoke can establish only an authenticated hosted storage path and the measured bytes once that live run is separately authorized and actually executed.

No production readiness, live upload, live email, activation, push, merge or deployment is claimed by local tests.
