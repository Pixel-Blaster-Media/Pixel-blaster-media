# Photo finals application — local executable candidate, production unavailable

**Production adapter follow-up:** see `PHOTO_FINALS_PRODUCTION.md` for the real, separately gated R2 presigner/Supabase transport and bounded shared-cron integration. Older nonactivating-factory statements below are historical. Nothing has been activated.

## Local acceptance closure (base `72524e00ee7304508305fefd3b1aac80175613f7`)

This checkpoint supersedes the three local omissions below. Production remains unavailable; no production factory, schema, resources, credentials, deployment, or email transport was activated.

- **Canonical private-stream grants:** the existing `download_grants` and append-only `download_events` tables now receive service-only issuance, single-resolution accounting, settlement and revocation. Issuance and its `grant_resolved` event commit atomically under canonical tenant/batch/release locks, with fresh actor, tenant, booking/property ownership, latest release, package and rights checks. No bearer token or object URL is exposed. These grants authorize one login-authorized proxy stream, not permanent access; revoking one stream does not replace profile/booking/release authorization policy for future requests. Completed streams and failed/cancelled streams settle to the existing `controlled_proxy_completed` / `denied` event vocabulary. Settlement rechecks current access and readiness, releases the grant, and is idempotent. One-chunk lookahead withholds final bytes until checksum validation and audit settlement succeed. A crash or failed audit commit leaves an unresolved `grant_resolved` record rather than invented completion; network receipt by the customer is not claimed.
- **Canonical recovery:** a tenant-serialized server lookup reuses the actor's exact hash/size intent in the authorized booking/property despite new tab IDs, cleared/unavailable browser storage, or an ambiguous response. New files extend only the newest eligible unapproved batch; older abandoned batches are not resurrected. Browser Web Locks serialize same-identity cross-tab upload work. A verified quarantine HEAD resumes acceptance without another PUT; only verified absence permits upload capability issuance. The operator can inspect bounded server inventory and explicitly reconcile expired unleased intents through the existing canonical dead-letter transition. Reconciliation is bounded, idempotent and retains every intent/hash/object identity; it does not delete objects or create replacement uploads. Active leases remain fenced. Expired originals require retained-record/operator disposition, not an automatic duplicate attempt.
- **Real Next App Router:** the disposable test-only Next 16 app imports the actual editor and navigation-owner components and candidate-generated CSS. Its API bridge forwards to the existing actual-route-export/PG17/private-storage harness; it does not fabricate finals data. Chromium exercises programmatic navigation, cancelled Back and Forward, delayed B reads followed by A, a committed A save whose response arrives while B is selected, session changes before mutation, and a session change between committed save and refresh. The last case exposed and fixed an old receipt appearing under a new session. The owner guards descendant App Router push/replace plus history traversal; ordinary external workspace links still use capture confirmation. This is not the full production admin layout, real Supabase authentication, middleware or PostgREST transport certification.

### Executable evidence

Run `npm run test:postgres:finals-http` from `booking`. It applies both new migrations only in disposable PG17 and shuts down the PG, HTTP and Next processes. Grant tests prove audit-insert rollback of issuance, duplicate-begin denial, revocation before drain, cancellation/read-failure audit and idempotent settlement. A real 100ms fixture deadline elapses before canonical expired-intent reconciliation and replay refusal. The four original component widths still complete upload/review/approval/package/gallery/ZIP; simultaneous same-file reselect after storage loss leaves no duplicate versions. Eight browser originals plus one synthetic property-B HTTP upload are retained in the aggregate upload count.

Verified locally: **617 repository tests**, TypeScript, ESLint, production build, actual-route/PG/browser/Next integration, existing ingest/package/approval-concurrency/canonical-media PostgreSQL suites, and diff whitespace checks. The older canonical-media runner needed `LC_ALL=C` to avoid Homebrew PostgreSQL's observed multithreaded-startup failure; it now starts Unix-socket-only and exposes startup diagnostics. Existing typeless-module and Next middleware warnings remain. The historical skin allowlist now correctly classifies the already-added finals gallery and owner as functional components, while existing page byte comparisons remain intact.

Evidence: `/tmp/pixel-finals-browser-evidence/next-router-390.png`, `next-router.log`, `proof.json`, `resolved-modules.json`, and the existing `{operator,realtor,gallery,gallery-short}-{320,390,768,1440}.png`. Next's 390px CSS/document widths are measured equal; screenshots are synthetic component/application fixtures, not customer photographs or physical Safari proof. Logs: `/tmp/pf-http-final.log`, `/tmp/pf-unit-final.log`, `/tmp/pf-build-final.log`.

### Remaining production gates

Independent exact-candidate approval is parent-owned and not claimed here. Production still requires the separate reviewed non-development storage/presigner factory and private resource/CORS/retention/credential certification; exact schema/ledger compatibility and approved migration application; real Supabase/PostgREST and fully mounted production-route verification; deployed processor/dispatcher, native-memory/concurrency/time-budget evidence at the authorized limits; MLS destination approval; physical Safari; kill-switch/allowlist and deployed verification. There is no paid/remote change, schema apply, production adapter activation, email send, push, merge or deploy. iGUIDE per-slot precedence, 100-photo/32MiB-per-photo/1GiB-batch limits, provider neutrality, billing and video policy are unchanged.

---

## Follow-up application checkpoint (base `99f0477c8c23e7295079675219d5ce43dffcb83c`)

This is a **tested partial acceptance slice**, not completion of every requested application gate.

- Send-time now calls the shared source policy with an authorized fresh canonical Pixel read, then reads again after awaited billing work immediately before rendering the email. No Pixel state is cached from preview. A missing/unavailable production factory still returns no Pixel candidates. A failed Pixel read removes Pixel only; legitimate legacy/video links remain eligible. Valid iGUIDE wins independently per format; no network-fetch fallback is used.
- Browser upload metadata is persisted before the first intent call, partitioned by server-issued tenant/actor/booking/property identity. Reselecting exact JPEG bytes reuses the same request/file intent after reload or ambiguous responses. Accepted SQL intents replay without allocating another capability. A failed PUT response is not acceptance: the existing canonical worker must still verify bytes. Expired/terminal/corrupt-journal cases retain identities and need reconciliation, not a new duplicate attempt. The UI describes reselect/refresh recovery; it does not claim automated abandoned-intent cleanup. A mutation identity header prevents a stale client session draft from executing under another identity.
- The booking-tab parent owns dirty flags and captures ordinary tab/property/sidebar link navigation before Next Link handlers. Cancellation retains selection and URL; native unload protection covers reload/close. Busy uploads are dirty too. This does **not** yet implement a general App Router programmatic/history navigation blocker, nor prove delayed-save/property-switch ordering in a real running Next application.
- Approved photos open a large, safe-area/dvh-bounded native dialog with previous/next, Arrow keys, Home/End, thumbnails, explicit Tab/Shift+Tab containment, Escape and exact opener focus restoration. Presentation retains silver/white/blue and restrained exterior corners. Downloads remain session-authorized, not public grants.

### New executable evidence

`npm run test:postgres:finals-http` passes with actual canonical PG17, actual Next route exports and real React components. The four widths (320/390/768/1440) each complete upload → order → approval → packaging → private gallery/ZIP. Added tests inject response loss after intent, PUT and acceptance; reload and same-file reselect leave exactly two canonical versions per tested batch and eight original browser PUTs overall. Gallery keyboard/focus checks and 480px-short-height bounds pass. Ordinary navigation confirmation cancellation is exercised with synthetic route links above the real editor/owner.

The integration also compiles the **actual `sendDeliveryReadyEmail` action and email template**. Auth/legacy booking query, billing settings, notifications and email transport are explicit test-only boundaries; the finals reader executes real PG. Four mocked transport calls verify exact full/MLS links, iGUIDE MLS precedence, video-only behavior, existing invoice URL preservation and exclusion after withdrawal during the awaited billing-settings step. **No real email, invoice or push is sent.** This does not certify actual email-provider or QuickBooks transport.

Final follow-up local gates: **617 repository tests**, HTTP/browser/PG integration, TypeScript, ESLint, production build and `git diff --check` pass. Full historical skin tests still reverse only exact frozen authorized functional hunks, including the navigation-owner wrapper, before original byte checks. Existing typeless-module and Next middleware warnings remain. Independent exact-candidate review is parent-owned and not claimed here.

Screenshots: `/tmp/pixel-finals-browser-evidence/{operator,realtor,gallery,gallery-short}-{320,390,768,1440}.png`. `proof.json` and `resolved-modules.json` remain there. Fixtures are synthetic colors/JPEGs, not customer photographs; browser emulation is not physical iPhone/Safari certification. Aggregate HTTP evidence is in `/tmp/pf-final-http.log`.

### Still required before application acceptance / production enablement

1. Canonical `download_grants` / `download_events` issuance, atomic accounting, revocation and audited completed/failed private stream behavior are **not implemented in this follow-up**. Existing fresh session authorization is unchanged. No substitute parallel tables or fake grant audit was added.
2. A real running Next/React application with synthetic local authentication and PG must exercise App Router/history navigation, delayed request/save and session/property switches, plus grant accounting. Existing evidence executes actual route exports in the local HTTP harness, **not Next middleware/server routing or real Supabase authentication/PostgREST**.
3. Durable recovery still needs reviewed cross-tab journal concurrency, browser-storage-loss and terminal/expired/abandoned-intent reconciliation/operator controls. The current journal stops rather than silently replacing corrupt/full metadata; no historical batch chooser or new correction-batch intent UI was added.
4. Separate reviewed production storage/presigner factory, private resource dedication/credentials/CORS/retention, live synthetic capability/cleanup certification, exact canonical migration/ledger review and approved rollout. The nonactivating production factory and synthetic-local execution gates remain unchanged.
5. Actual PostgREST/deployed processor architecture/encoder/max-byte/native-memory/concurrency/timeout budgets and dispatcher, destination-specific MLS approval, kill switch/allowlist review, independent exact-candidate approval, physical Safari and deployed verification.

No remote resource, schema, configuration, deployment, business-data or provider changes. No push/merge/deploy. Local canonical schema/migrations, storage adapter and upload limits are unchanged.

---

The following records the earlier application checkpoint and its then-open gates; the follow-up above supersedes its send-time, recovery and gallery status.

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
