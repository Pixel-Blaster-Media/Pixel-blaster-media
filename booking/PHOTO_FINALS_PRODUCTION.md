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

No production readiness, live upload, live email, activation, push, merge or deployment is claimed by local tests.
