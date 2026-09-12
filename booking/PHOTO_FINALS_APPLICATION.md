# Photo finals application — local executable candidate, production unavailable

Base: `87caa61815dd9ca8db5f84c41d8615b4b8a7a210`.

## What is connected

- `app/api/photo-finals/[bookingId]/route.ts` exports authenticated GET/POST handlers. Production identity uses the existing authoritative current-user boundary and session/RLS booking lookup. Service-only SQL independently rechecks current non-archived profile, tenant, booking/property, cancellation and operator membership or **both booking and property ownership** for realtor access.
- `http.ts` connects durable intent → capability request → actual JPEG ingest, immutable ordered review → approval → bounded operator-invoked package dispatcher. Exact operation fields, canonical IDs, 16 KiB streamed JSON cap/10-second read deadline, exact same-origin mutation checks, private/no-store responses and opaque errors. The application RPC adapter has a closed operation allowlist, bounded serialized envelopes and the existing 10-second cancellation-aware RPC deadline, including ingest calls.
- `20260912200000_photo_finals_application.sql` adds three service-only functions to the existing canonical model: access, current-state read, and exact upload target. No new tables or public placements. Latest batch/release is authoritative; pending or withdrawn latest state never resurrects an older release. Current rights, approval, both packages, every gallery/MLS derivative and completed package job must all agree before a gallery/download DTO exists.
- Private review images require current operator authorization and accepted versions. Realtor image/ZIP requests resolve **IDs**, never caller-selected keys, through a fresh authorized current-state read. The storage key grammar, tenant, class, bucket, exact hash and size are checked. GETs drain through the existing validating stream, use a 60-second budget and do not use Next's shared image optimizer. Streams can fail after headers; a 200 header alone is not checksum verification.
- The real `PhotoFinalsWorkspace` component is mounted in operator Media and the latest-booking realtor photo section. Sequential finished JPEG upload, acceptance state, selection, earlier-order control, server review receipt, explicit approval, package preparation, private gallery and ZIP links are real interactions. A changed selection clears its approval receipt. Booking-keyed component state prevents another booking inheriting a draft. Refresh errors remove previously displayed Pixel readiness.
- Both UI consumers use the existing per-slot source selector. Valid iGUIDE candidates are supplied independently of Pixel availability; an iGUIDE fetch error does not substitute Pixel for that occupied slot. Existing source/provider controls, legacy tabs, video, billing and public listing code are preserved. Historical skin-only tests now reverse only a frozen exact functional delta before their original byte comparisons.

## Deliberate production boundary — not a production storage implementation

`createProductionFinalsRuntime` is a **non-activating factory boundary** and currently returns unavailable even with production eligibility flags. It does not create an R2 client or a production upload capability. It never calls/relaxes the development storage factory. The existing ingest/package execution gates still reject production. The normal application has no route to enable the synthetic adapter.

Thus missing configuration/schema is truthful disabled UI with no file picker, canonical read, storage allocation or placeholder success. This candidate is **not the completed production slice**. A configured, reviewed production storage/capability factory remains work, not merely an environment-variable flip.

## Actual local browser/route proof

Run from `booking`:

```sh
npm run test:postgres:finals-http
npm run test:photo-finals
npm test
npm run typecheck
npm run lint
npm run build
```

The new runner creates a disposable Unix-socket-only PG17 cluster, applies canonical/ingest/packages/application migrations and synthetic fixture rows, and tears it down before reporting success. It invokes the actual SQL functions as `service_role`, not mocked RPC results. Browser/server tests are loopback-only and synthetic.

The HTTP browser harness compiles **the actual Next route GET/POST exports and real component**. Only authoritative session lookup/session booking lookup and the unavailable production factory are replaced with explicitly test-only boundaries. AsyncLocalStorage binds those fictional identities per request. This proves actual route exports and application handlers, **not Next middleware, real Supabase authentication, PostgREST wire transport, or a deployed Next server**.

The browser PUTs actual generated JPEG bytes over a test-only HTTP storage endpoint. Its opaque one-use capability is issued only after SQL intent commit, binds exact actor/job/private quarantine key/hash/size, expires after at most 60 seconds (also bounded by durable intent expiry), requires explicit headers/create-only policy, and reauthorizes the durable upload target at PUT. R2Storage behind it uses the existing local S3 command double. This is **not a real R2 presigner, CORS policy, or provider storage proof**. Capability state is disposable test memory; only the canonical ingest intent is durable SQL.

At each 320/390/768/1440 CSS-pixel width the real component uploads two JPEGs, selects both, reverses their order, saves a review snapshot, approves, generates packages, renders the gallery, and downloads the full-resolution ZIP. The first extracted STORE entry is byte-compared with the second source. Separate route integration downloads both real ZIP types; existing package tests independently check both ZIPs' CRC/order/content. Operator and realtor document/client/scroll widths agree; visible buttons/links/file input are at least 44px. No static fake success/gallery responses are substituted.

Adversarial coverage includes wrong user/tenant, archived operator/realtor, withdrawn release with an old download URL, drafts and incomplete package state, stale revision and digest, cross-origin mutation, capability wrong user/hash header/oversize/expiry/revocation, and injected HTTP response errors. Browser iGUIDE MLS remains selected despite an explicit synthetic 503 while Pixel fills only the missing full-resolution slot. Four intentional UI read-error responses are retained in the proof rather than ignored.

Evidence: `/tmp/pixel-finals-browser-evidence/{operator,realtor}-{320,390,768,1440}.png` and `proof.json`. These are synthetic component screenshots, not live property photographs or production screenshots.

The runner uses an existing local Playwright installation by default at `~/.hermes/designs/pixel-precision-preview/node_modules/playwright/index.mjs` and installed Google Chrome. For another machine set `PF_PLAYWRIGHT_MODULE` and `PF_CHROME_PATH`; install dependencies separately. No package/resource purchase or remote setup is performed by the test.

## Verification checkpoint

Final local run: **615 repository tests passed**, TypeScript, ESLint and production build passed; the actual-route/browser/PG17 integration passed with eight browser JPEG uploads across all four widths. Existing ingest, package, observed-lock approval-concurrency and canonical-media PostgreSQL suites also passed during this slice. Existing typeless-module and Next middleware-deprecation warnings remain. Independent exact-candidate approval was not obtained; this is a local tested checkpoint for parent review, not release approval.

## Remaining acceptance gates and limitations

1. Independent exact-candidate review; real production schema/ledger compatibility and exact approved migrations only. No broad database push, remote apply or production credential access occurred.
2. Implement/certify the separate production storage factory, dedicated private resources, exact browser origins/headers/create-only capability behavior, durable capability lifecycle/reconciliation and retention. Do not reuse the synthetic development bucket or test HTTP server.
3. Actual PostgREST/serverless execution and maximum-byte/memory/concurrency/download budgets. Existing large-resource/125-second proof is from the prior package candidate; not rerun or newly certified here. Operator package requests can run locally up to the existing 15-minute worker budget; no production dispatcher is installed.
4. Fresh email/send-time Pixel resolution is **not wired**; legacy email links remain unchanged, and no email was sent. No billing or video-completion behavior changed.
5. No persistent browser retry journal or operator abandoned-intent/cleanup UI yet. Refresh recovers displayed durable state, but re-upload after an ambiguous response can encounter the existing hash-collision fence. A new browser session starts a new batch; there is no historical batch chooser. Current-state reads deliberately expose only the newest batch.
6. Selection has native reload/close dirty protection, but in-app workspace-tab navigation does not yet have a parent-owned dirty-selection confirmation. The gallery is a responsive image grid, not the final large-preview/thumbnail viewer. No physical iPhone/Safari verification.
7. Private downloads use a fresh authorized session and current release state, not issued shareable download grants. Grant-specific audit/revocation and download event accounting are not connected. Rights windows are rechecked in SQL; this run exercises actor revocation/withdrawal, not a real elapsed rights-expiry fixture.
8. No production enablement, push, merge, deploy, paid activation, RAW ingestion, provider job, public listing exposure, or secret/resource purchase.
