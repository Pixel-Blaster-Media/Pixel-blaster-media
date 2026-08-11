# Media Execution Sink Inventory

**Status:** Release 0 discovery baseline

**Purpose:** Identify every supported path that accepts, fetches, uploads, redirects, stores, displays, emails, or deletes media references before Pixel introduces canonical asset storage.

## Preservation rule

Pixel Booking is live business infrastructure. **No current customer record, deliverable, file, or route is deleted by Release 0.** Release 1 will use additive tables, compatibility reads, tenant-scoped flags, exact-record pilots, and fallback paths. Any later route or field retirement requires a complete caller search, migrated data, monitored zero supported use, reversible release evidence, and explicit approval.

## Classification

- **Retain and harden:** the capability remains part of the product, but its boundary needs stronger limits, identity, or audit evidence.
- **Migrate behind compatibility read:** new records use canonical media/release IDs while legacy records continue to work through the existing path.
- **Retire only after zero supported use:** a temporary, test, proxy, or URL-based execution path may be removed only after callers are migrated and production telemetry proves no supported dependency.
- **Out of canonical-media scope:** fixed-provider control-plane APIs such as Calendar, QuickBooks, Resend, OpenAI, weather, and Auth are important but do not ingest or publish listing media bytes.

---

## 1. Server-side remote media downloads and proxies

| Sink | Input and ownership | Current controls | Current gap | Migration |
|---|---|---|---|---|
| `app/api/iguide/download/route.ts` | Signed-in request supplies an iGUIDE document URL. Route parses alias and proves a tenant-owned booking with matching `organization_id`/`iguide_id`. | HTTPS-only; exact `youriguide.com` host; `/doc/` plus approved suffixes; 30-second timeout; token refresh; private/no-store response; safe filename. | The route streams the upstream body without an application byte ceiling, MIME allowlist, content-encoding policy, checksum, persistent download evidence, or canonical rehosting. Redirect behavior depends on `fetch` defaults. | **Migrate behind compatibility read.** New iGUIDE outputs enqueue bounded ingestion and deliver Pixel packages. Keep this route for unmigrated historical rows, then **Retire only after zero supported use**. |
| `lib/integrations/autoenhance/client.ts` (`fetchEnhancedImage`) | Server constructs a fixed Autoenhance `/v3/images/{id}/enhanced` URL from a provider image ID and tenant-scoped credential. | Fixed provider base, encoded ID, tenant-scoped API key, no-store, 60-second timeout, success-status check. | Returns raw `Response`; no declared/streamed byte bound, MIME/content-encoding validation, checksum, or durable asset identity. Provider error body is read and retained in an error object. | **Retain and harden** inside the media worker. Ingest to quarantine, validate, checksum, preserve immutable master, and sanitize provider errors. |
| `app/api/autoenhance-test/enhanced/[imageId]/route.ts` | Admin preview URL emitted by `lib/integrations/autoenhance/workflow.ts` and `app/api/admin/autoenhance-test/_helpers.ts`; route downloads an Autoenhance result with tenant credentials and streams it to the admin browser. | Admin authentication, organization-scoped API key, fixed provider endpoint, normalized output format and provider timeout. | Streams provider-controlled bytes and `Content-Type` without byte, MIME, magic-byte, content-encoding, dimension, or checksum validation. Provider error bodies are cleaned but still rendered to the operator, and the supplied image ID is reused in `Content-Disposition`. | **Retain and harden immediately**, then migrate preview rendering to canonical quarantined/validated derivatives. Do not remove while either caller emits this route. |
| `lib/integrations/autoenhance/workflow.ts` (`pushFinishedImagesToIGuide`) | The production admin workflow downloads each finished Autoenhance image and uploads it to iGUIDE. | Admin/tenant context, durable batch/image claims, fixed providers, sequential per-image work and provider timeouts. | Calls unbounded `arrayBuffer()` before upload and trusts provider content type; no media byte/dimension limit, checksum, quarantine, or canonical copy. | **Migrate behind compatibility read.** Route finished output through bounded canonical ingestion and stream approved bytes to iGUIDE; keep current workflow behind the existing path until exact pilot parity is proven. |
| `app/api/admin/autoenhance-test/upload-to-iguide/route.ts` | Admin supplies iGUIDE ID and up to 80 Autoenhance image IDs. Server downloads Autoenhance output and uploads to iGUIDE. | Admin/tenant authorization, count cap, sequential work, provider timeouts. | Calls `arrayBuffer()` on each provider body with no byte/MIME/dimension bound; performs paid/external work in one request; exposes raw exception text; uses preview fallback; no durable job/asset record. | Test path only. **Retire only after zero supported use** once queued canonical ingestion plus iGUIDE handoff exists. Do not delete during Release 0/1. |
| `app/admin/fotello-test/actions.ts` | Admin-only sandbox calls fixed candidate Fotello endpoints and uploads through presigned URLs. | Admin gate, candidate fixed bases, endpoint diagnostics, browser upload. | Private/experimental contract, output URLs not canonical, incomplete timeout/idempotency/limits. | Keep hidden. **Retire only after zero supported use** or replace after current Fotello contract is preserved and verified. |

### Required replacement boundary

A canonical loader must use HTTPS, provider-specific host allowlists, all-answer DNS classification, transport binding, manual redirect validation, one total deadline, streamed byte ceilings, MIME/encoding checks, SHA-256, quarantine, decoder/archive validation, malware scan, immutable object keys, and tenant-qualified persistence. It must never use unbounded `arrayBuffer()` for provider media.

---

## 2. Provider control-plane clients that discover media URLs

| Sink | Behavior | Risk to canonical media | Migration |
|---|---|---|---|
| `lib/integrations/iguide/portal-client.ts` | Tenant-scoped fixed-base API client retrieves ready events and media URL collections and uploads assets to iGUIDE. | Returned URLs and access tokens are temporary capabilities; provider response shape is permissive. | **Retain and harden.** Adapter records native IDs/revisions/expiry and enqueues output ingestion. Webhooks remain hints; polling reconciles. |
| `lib/integrations/iguide/client.ts` | Fetches public RESO/autofill data from a fixed iGUIDE endpoint. | Useful metadata discovery, not durable media ownership. | Retain as bounded metadata fallback; never infer asset completion from it. |
| `lib/integrations/autoenhance/client.ts` | Creates orders/images/uploads and discovers status/output resources using tenant credentials. | Provider IDs need deterministic local identity and version pinning. | Retain behind provider adapter and mutation/idempotency ledger. |
| `lib/integrations/fotello/client.ts` | Private API creates listing/upload/enhance and prepares downloads. | No preserved public spec, output TTL/limits or stable OEM contract. | Keep gated; do not make canonical production dependency until contract/spec pass. |
| `lib/integrations/fotello/sync.ts` | Refreshes expiring Fotello gallery URLs and upserts `deliverables`. | URL refresh is mistaken for durable delivery; no canonical images/ZIPs/checksums. | **Migrate behind compatibility read.** Keep legacy refresh for old deliverables while new supported outputs ingest into canonical assets. |
| `lib/integrations/iguide/sync.ts` | Converts iGUIDE event/media URLs into tour, floor plan, preview and photo-gallery `deliverables`. | `deliverables.url`, `thumbnail_url`, and metadata URL arrays become durable-looking identities even when provider URLs expire. | **Migrate behind compatibility read.** Preserve tour metadata but create ingest jobs for downloadable assets and release references for delivery. |

### Admin iGUIDE identifier acceptance and sync initiation

| Sink | Accepted input and action | Current controls | Migration |
|---|---|---|---|
| `app/admin/iguide/page.tsx` (`IGuideReviewPage`) | Feature-gated admin form accepts a public, unbranded, or manage iGUIDE URL, alias, or Portal ID plus a booking; it also surfaces unmatched webhook events for manual booking association. | `ENABLE_IGUIDE_REVIEW` gate, authenticated admin page, explicit booking selection. | **Retain and harden.** Preserve manual import/recovery throughout canonical-media rollout; do not remove this UI when release-first reads are introduced. |
| `app/admin/iguide/LinkEventForm.tsx` | Accepts an iGUIDE webhook-event/booking association and calls `linkIGuideWebhookEvent`; it can also explicitly ignore an event. | Admin page context, explicit booking/event identifiers, visible operator result. | Preserve as the operator reconciliation path. Canonical ingestion must follow the successful tenant-scoped sync rather than bypassing or replacing review decisions. |
| `app/admin/iguide/actions.ts` (`linkManualIGuideToBooking`, `linkIGuideWebhookEvent`) | Parses the submitted iGUIDE reference, tenant-scopes the booking/event, writes `bookings.iguide_id` or `iguide_portal_id`, then calls `syncIGuideForBooking` or `syncIGuideFromReadyEvent`, which can persist deliverables. | `requireAdmin`, `organization_id` predicates, recognized alias/Portal-ID parsing, explicit booking association. | **Retain and harden.** Treat this as a media-reference acceptance and sync-initiation boundary. Add canonical ingestion only after the existing association and sync succeed; preserve current booking fields and deliverable fallback. |
| `app/admin/bookings/[id]/IGuideSection.tsx` | Booking-level operator surface accepts pasted URLs, aliases, and Portal IDs through `saveIGuideId`; can choose an existing tour, call `listExistingIGuides`, create through `createIGuideForBooking`, invoke `syncIGuide`, save photo-download URLs, and clear the current booking references. | Booking-scoped admin surface, explicit operator buttons, provider capability checks, visible success/error state. | **Retain and harden.** This is the primary booking-level iGUIDE association and recovery workflow. Preserve every save/list/create/sync/download action and legacy field fallback during Release 1. |
| `app/admin/bookings/[id]/actions.ts` (`saveIGuideId`, `listExistingIGuides`, `syncIGuide`, `createIGuideForBooking`) | Parses booking-level identifiers independent of form shape, writes or clears `iguide_id`/`iguide_portal_id`, lists Portal tours, creates iGUIDEs, and synchronizes provider media into deliverables. | `requireAdminForBooking`, tenant-qualified provider clients and database predicates, explicit recognized identifier parsing. | **Retain and harden.** Canonical ingestion may follow successful sync, but must not bypass this chain or reinterpret a cleared association as permission to delete historical media/deliverables. |

Repository-backed discovery treats provider forms, exact iGUIDE booking action call sites, and exact exported action definitions as execution sinks, in addition to fetches, byte buffers, redirects, embeds, storage operations, and deliverable mutations.

---

## 3. Browser-to-provider presigned uploads

| Sink | Source and destination | Current controls | Migration |
|---|---|---|---|
| `app/admin/bookings/[id]/AutoenhanceSection.tsx` | Admin browser uploads selected files to Autoenhance presigned URLs. | Server obtains provider intent/credentials; API key stays server-side. | Retain upload transport, but persist local upload/job identity and aggregate limits before provider mutation. Canonical output still returns through worker ingestion. |
| `app/admin/autoenhance-test/AutoenhanceTestClient.tsx` | Admin sandbox direct upload to Autoenhance. | Admin test surface. | Keep isolated; later retire after production path covers diagnostics. |
| `app/admin/bookings/[id]/FotelloSection.tsx` | Admin browser uploads to Fotello presigned URLs. | Server obtains upload capability; API key server-side. | Keep hidden/gated. Add bounded concurrency and local job ledger before any production promotion. |
| `app/admin/fotello-test/actions.ts` | Server and browser exercise Fotello upload candidates. | Admin only. | Test-only compatibility; no new production dependency. |

Presigned upload URLs are bearer capabilities. Do not log them or persist full query strings. File count, byte total, per-file bytes, provider calls, credits, concurrency, and route/session duration must share one aggregate budget.

---

## 4. Persisted external URL writers

| Sink | Fields written | Current validation | Risk | Migration |
|---|---|---|---|---|
| `app/admin/bookings/[id]/actions.ts` (`addManualDeliverable`) | `deliverables.url`, optional `thumbnail_url`, delivery metadata | Admin/booking tenant check; main URL must be HTTPS. | Thumbnail is not equivalently validated; arbitrary external host becomes durable public/portal display input and possible future second-order fetch input. | **Migrate behind compatibility read.** New manual media should import/canonicalize bytes or explicitly remain a typed external-link deliverable. Preserve old rows. |
| `app/admin/bookings/[id]/actions.ts` (`saveIGuidePhotoDownloads`) | Replaces the manual iGUIDE photo-download deliverable with validated MLS/high-resolution iGUIDE ZIP URLs, or deletes the row when both inputs are blank. | Admin authorization and a tenant-qualified booking lookup; iGUIDE host/path/type validation; deterministic external ID. | The delete uses service role and filters only `source` plus derived `external_id`; it lacks explicit `organization_id` and `booking_id` predicates. Upsert conflict identity includes organization, but the inserted row relies on database population of organization identity. | **Retain and harden before migration.** Add explicit tenant and booking predicates, test cross-tenant collision behavior, and later convert URLs into canonical ingestion intents while preserving the legacy row. Never bulk-clear inputs during backfill. |
| `app/admin/bookings/[id]/actions.ts` (`saveFotelloDeliveryLinks`) | Deletes all known Fotello delivery-link rows for the booking, then inserts the currently supplied external gallery, download, branded-site and unbranded-site URLs. | Admin authorization, tenant-qualified booking lookup, HTTPS checks, booking/source/external-ID delete predicates. | Delete-then-insert is not atomic; an insert failure can remove working business links. URLs remain provider capabilities without provenance or expiry guarantees. | **Retain and harden.** Replace with one transactional tenant-qualified RPC or additive upsert/supersession before relying on it; canonicalize downloadable outputs only where the contract permits. |
| `app/admin/bookings/[id]/actions.ts` (`saveListingWebsite`) | `listing_websites.hero_image_url`, `gallery_image_urls`, CTA URL | HTTPS/mailto/tel scheme checks and tenant-scoped booking. | Arbitrary URL strings are public page identity; no approved release/version binding, expiry, rights, checksum, or revocation. | Replace with release/derivative IDs for new sites. Keep URL compatibility for existing sites until individually migrated. |
| `app/portal/[propertyId]/listing-website-actions.ts` | Same website URL fields from realtor portal | User/property/organization predicates; scheme checks; URL count cap. | Same arbitrary-URL and lineage gaps. | Same additive migration and compatibility read. |
| `lib/integrations/iguide/sync.ts` | `deliverables.url`, `thumbnail_url`, metadata image/download URLs | Provider-host allowlisting helpers and tenant-scoped upsert. | Expiry and provider availability remain user-facing truth. | New sync creates provider event/output identities and ingestion intents; preserve old deliverables. |
| `lib/integrations/fotello/sync.ts` | Expiring gallery URL or `about:blank` sentinel plus status metadata | Tenant-scoped booking/property/provider lookup. | URL is refreshed rather than rehosted; sentinel leaks storage-model limitations. | Keep gated legacy behavior; canonical release only after actual output asset ingestion. |

### Deliverable deletion and replacement boundaries

| Operation | Current scope and caller | Production risk | Required treatment |
|---|---|---|---|
| `app/admin/bookings/[id]/actions.ts` (`deleteDeliverable`), called by `app/admin/bookings/[id]/BookingActions.tsx` | Admin confirms in the browser; server proves booking access, then deletes by deliverable `id` and `booking_id`. | The service-role delete does not repeat `organization_id`, does not detect released/listing/email references, and has no audit or undo record. | Preserve current behavior for existing operator use, but do not call it from migration. Before canonical assets depend on it, require explicit tenant scope, reference checks, audit and exact rollback semantics. |
| `app/admin/bookings/[id]/actions.ts` (`saveIGuideId`), called by `app/admin/bookings/[id]/IGuideSection.tsx` | A blank operator input clears both `bookings.iguide_id` and `iguide_portal_id`; nonblank input saves a parsed alias or Portal ID. | Booking-level admin authorization and explicit `organization_id` predicate. | Clearing removes the active provider association and can hide the path used for later synchronization, even though it does not delete existing deliverables or provider media. | Preserve the explicit operator action, but canonical migration must never call it as cleanup or treat it as authorization to remove assets, releases, or historical delivery references. |
| `app/admin/bookings/[id]/actions.ts` (`saveIGuidePhotoDownloads`) | Blank MLS and high-resolution fields delete the derived iGUIDE photo-download row. Caller: `app/admin/bookings/[id]/IGuideSection.tsx`. | Delete lacks explicit tenant/booking predicates and can silently remove a currently delivered link. | Harden before Release 1 pilot; migration never submits blank forms or uses this path for cleanup. |
| `app/admin/bookings/[id]/actions.ts` (`saveFotelloDeliveryLinks`) | Every save deletes all recognized Fotello delivery-link rows for the booking before inserting supplied rows. Caller: `app/admin/bookings/[id]/FotelloSection.tsx`. | Non-atomic replacement can lose valid links if insert fails; omitted fields are intentionally removed. | Replace with a tenant-qualified transaction or supersession workflow before promotion; preserve the current hidden workflow until parity is tested. |
| `app/admin/bookings/[id]/actions.ts` (`untrackFotelloEnhance`) | Explicit operator confirmation removes one Fotello deliverable by `id`, `booking_id`, and source; provider object remains. Caller: `app/admin/bookings/[id]/FotelloSection.tsx`. | No explicit `organization_id`, reference check, audit, or undo; name “untrack” can obscure that the local delivery row is deleted. | Keep gated; do not use for migration. Add tenant predicate and audit before canonical release references exist. |
| `lib/integrations/iguide/sync.ts` (`upsertDeliverables`) | After successful upsert, selects managed iGUIDE rows by `booking_id`/source and deletes stale managed IDs. Triggered by admin sync and webhook reconciliation. | Cleanup is automatic. It does not repeat `organization_id`, and stale rows may still be referenced by sent emails or historical pages. | **Retain and harden.** Add tenant-qualified selection/delete, record supersession, and preserve historical release references. Canonical migration must not reinterpret legacy external IDs or expand the managed-ID predicate. |

All service-role media mutations must use explicit `organization_id` and `booking_id` predicates wherever those columns exist. Database uniqueness is not a substitute for mutation scope. Existing deliverables must never be bulk-deleted during migration.

---

## 5. Public and authenticated media display sinks

| Sink | Data source | Exposure | Migration |
|---|---|---|---|
| `app/portal/[propertyId]/page.tsx` | Ready tenant-readable deliverables, metadata image URLs, thumbnail URLs and direct URLs. Also proxies iGUIDE downloads. | Authenticated realtor/admin portal; third-party images, iframe tours, videos and download links. | **Migrate behind compatibility read.** Prefer selected approved release items and Pixel download grants. Preserve legacy rendering when no migrated release exists. |
| `app/listings/[slug]/page.tsx` | Service-role reads published site, property and all ready property deliverables; selects `hero_image_url`/`gallery_image_urls`. | Public page renders arbitrary third-party `<img>` and approved video/iGUIDE iframes. Uses Unsplash fallback. | Bind public pages to one approved release and public derivative IDs. Legacy sites continue through URL compatibility until migrated. Add withdrawal/cache policy and embed allowlists. |
| `app/portal/[propertyId]/ListingWebsiteEditor.tsx` | Provider/legacy image URLs supplied as options and previews. | Authenticated browser loads remote images directly. | Switch options to approved web derivatives; retain old URL previews for legacy records. |
| `app/admin/bookings/[id]/ListingWebsiteSection.tsx` | Same legacy/provider image options. | Admin browser direct remote loads. | Same release-ID migration. |
| `app/portal/page.tsx` and `lib/booking/media-images.ts` | Deliverable thumbnails/image URLs selected by extension/host. | Authenticated property cards load remote images. | Prefer canonical thumbnail derivative; legacy selection remains fallback. |
| `lib/email/templates.ts` and delivery senders in `app/admin/bookings/[id]/actions.ts` | Ready deliverable URLs and portal link. | URLs leave the app by email and can outlive provider capability. | Email the Pixel property/release page and short-lived/revocable grant, not permanent provider bearer URLs. Preserve current email until new delivery passes pilot. |

Every public image/iframe source needs an explicit policy. A URL being HTTPS is not sufficient for property accuracy, availability, privacy, CSP, revocation, or rights.

---

## 6. Redirect-only delivery surfaces

| Sink | Behavior | Gap | Migration |
|---|---|---|---|
| `app/api/fotello/embed/[deliverableId]/route.ts` | Requires user, relies on RLS to select deliverable, refreshes gallery URL, then redirects browser to Fotello. | Browser receives expiring provider URL; access after redirect is controlled by Fotello capability, not Pixel; logs user/deliverable identifiers. | Keep gated for legacy Fotello rows. Replace with Pixel gallery after canonical output ingestion. **Retire only after zero supported use.** |
| Direct iGUIDE/tour/video links built by `lib/booking/delivery-links.ts` | Returns provider links or local iGUIDE proxy links. | Capability/rights/expiry and branded/unbranded policy differ by provider/destination. | Normalize as typed external experiences attached to a release; do not treat links as image assets. |
| `lib/integrations/iguide/parse-id.ts` (`iGuideEmbedHtml`) | Constructs a fixed iGUIDE iframe HTML string from a normalized alias; downstream sync persists `embed_html`. | Fixed iGUIDE embed URL and alias parsing reduce arbitrary-host risk. Raw HTML remains a persistent execution sink rendered by portal/listing surfaces. | **Retain and harden.** Prefer structured provider/embed identity with renderer-owned allowlisted markup; preserve legacy `embed_html` compatibility until all records migrate. |

---

## 7. Existing managed object storage

| Sink | Object class | Current design | Canonical-media decision |
|---|---|---|---|
| `app/admin/realtors/actions.ts` | Realtor profile photo and brokerage logo | Server validates/encodes bytes, uploads to Supabase Storage, returns public URL. | Out of listing-master scope. Retain for profile/brand media, but include in later managed-object mutation/deletion audit. |
| `app/admin/settings/business/actions.ts` | Organization brand assets | Server uploads bytes to Supabase Storage and stores public URL. | Retain for tenant brand media. Do not reuse public profile/brand buckets for private listing masters or packages. |

Canonical listing media should use separate private quarantine, master, delivery, and approved-public derivative buckets. Database rows and tenant ownership—not key prefixes—authorize access.

---

## 8. Fixed-provider APIs outside listing-byte ingestion

The repository also uses fixed endpoints for Resend, Google Calendar/OAuth, QuickBooks, OpenAI, Open-Meteo, geocoding, Supabase Auth, and health diagnostics. They require their own timeout, secret, tenant, response-size, and disclosure controls, but they do not currently load listing media bytes and are outside this Release 0 canonical-media migration.

---

## 9. Migration order

1. Add canonical media/release schema without altering `deliverables` or `listing_websites` behavior.
2. Add private storage and worker infrastructure with no production caller.
3. Ingest synthetic files and create synthetic releases only.
4. Pilot exact authorized Pixel output IDs behind an organization feature flag.
5. Add portal compatibility read: approved release first, current deliverables fallback.
6. Add listing-page compatibility read: selected approved release first, current URL arrays fallback.
7. Switch delivery email to Pixel release links only for migrated releases.
8. Measure fallback usage and failures.
9. Migrate historical records only by exact, verified, reversible batches; never infer provider revision identity from URL alone.
10. Retire test/proxy routes only after all callers are removed and monitored supported use is zero.
11. Keep legacy columns until a separately reviewed migration proves no supported reads/writes and an archival/export policy exists.

## 10. Release 1 priorities

1. `fetchEnhancedImage` output ingestion through a bounded worker.
2. Immutable asset/version/derivative/release/package records.
3. Full-resolution and provisional Ontario profile derivatives.
4. R2-backed packages and short-lived Pixel download grants.
5. Portal release-first compatibility read.
6. iGUIDE downloadable output ingestion and eventual proxy retirement.
7. Listing-page release binding.
8. Fotello remains gated until actual output assets and commercial rights are contractually available.

This inventory is a discovery artifact. It changes no runtime behavior and deletes nothing.
