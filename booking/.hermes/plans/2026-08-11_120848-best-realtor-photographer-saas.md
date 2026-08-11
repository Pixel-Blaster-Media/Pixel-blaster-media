# Pixel Blaster Real Estate Media OS Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Turn Pixel Blaster Booking into the best SaaS operating system for real-estate photographers and the release platform realtors and brokerages actively ask their photographers to use.

**Architecture:** Preserve the existing Next.js/Supabase multi-tenant booking product as the control plane, then add provider-neutral media ingestion, immutable asset/version/release records, Cloudflare R2 object storage, containerized media workers, destination-specific export profiles, structured approval/revisions, and publish-verification receipts. Build the differentiating workflow around one property identity and one immutable listing release rather than adding disconnected CRM, gallery, editing, and website features.

**Tech Stack:** Next.js 15 App Router, React 18, TypeScript, Tailwind, Supabase Postgres/Auth/RLS, Cloudflare R2/Images/Queues, AWS SDK v3, Node.js container workers, Sharp/libvips, Resend, QuickBooks, Google Calendar, iGUIDE, Autoenhance.ai, Imagen, managed-editor adapters, Playwright, Node test runner.

---

## 1. Product thesis

Pixel Blaster should not compete as another booking calendar, generic CRM, pretty gallery, or basic property-site builder. Those are crowded table stakes.

The product category is:

> **The listing-readiness, media-production, approval, release, and publishing command centre for real-estate media.**

The complete job is:

```text
Book → coordinate → verify access/readiness → capture → upload → edit
→ QC → revise → approve → package → release → publish → verify
→ invoice → report → archive/reuse
```

### Primary buyer

- Solo photographers
- Real-estate media companies
- Small and mid-sized photography teams
- Later: brokerage-approved media vendors and brokerage operations teams

### Realtor pull

Realtors should ask photographers to use Pixel because it gives them:

- verified property access and shoot readiness;
- one accepted shot brief and scope record;
- a shared listing timeline;
- structured revision requests with visible resolution;
- full-resolution and destination-ready downloads;
- branded and MLS-safe listing pages from the same approved release;
- confidence that the correct version reached each destination;
- a reusable property media archive that does not depend on old emails or expiring vendor links.

### Photographer pull

Photographers should pay for Pixel because it gives them:

- high-conversion booking and upsells;
- constraint-aware scheduling and routing;
- field workflow and access information;
- provider-neutral editing orchestration;
- fewer lost files and revision disputes;
- pay-before-release and automated invoicing;
- client retention, reporting, and brokerage relationships;
- a credible SaaS-quality workflow without stitching together six tools.

---

## 2. Current-state summary

Already present and worth preserving:

- Multi-tenant companies, branding, catalog and organization-scoped integrations
- Public company signup/beta onboarding and branded booking pages
- Booking wizard, package/add-on selection, availability and admin inbox
- Admin Today command centre, calendar, booking pipeline and team workflows
- Realtor portal and searchable property history
- iGUIDE delivery, tours, floor plans, MLS/high-resolution links
- Autoenhance.ai upload/editing workflow
- Hidden Fotello connector foundation
- QuickBooks, Google Calendar, Resend, push notifications and OpenAI tools
- Four branded property-page templates
- Realtor/agent profiles, logos/headshots, delivery CCs and agent memory
- Integration outbox/recovery foundations

Current structural gaps:

- `deliverables.url` and `listing_websites.gallery_image_urls` treat third-party URLs as durable media identity.
- There is no Pixel-owned immutable master/version/release model.
- Provider ZIPs are proxied instead of securely ingested, validated and rehosted.
- “MLS size” is not represented as a versioned destination policy.
- Approval, revision, payment, packaging and publishing are not one state machine.
- Editing provider capabilities and commercial rights are not normalized.
- Listing pages do not bind to immutable approved releases.
- There is no publish-and-verify receipt ledger.
- Brokerage procurement, budgets, standards and consolidated billing are not yet productized.

---

## 3. Product principles and non-negotiables

1. **Property identity is immutable.** Every booking, asset, revision, release, page, invoice and destination receipt binds to one tenant-qualified property identity.
2. **Provider URLs are transport, never truth.** Pixel ingests, validates, checksums and owns released assets.
3. **Masters never mutate.** Corrections create versions; approvals bind immutable manifests.
4. **MLS compliance is destination- and version-specific.** Never claim universal MLS compliance.
5. **Human approval gates material changes.** No generative property edit auto-publishes.
6. **Webhooks are hints.** Reconciliation reads authoritative provider state.
7. **Multi-tenant rights are a release gate.** API access alone is insufficient; OEM/resale and processing rights must be written.
8. **Sent is not live.** External publishing requires verification evidence.
9. **Production remains fail-closed.** Pixel Booking is live and used by clients; every release needs exact migration, test, rollout and rollback evidence.
10. **Mobile is a first-class workflow.** Realtors must not depend on desktop ZIP extraction for normal photo delivery.
11. **Build differentiation; buy infrastructure.** Own workflow, policy, release semantics and audit evidence; use managed storage, codecs, messaging and payments.
12. **Do not overbuild generic CRM features.** Every major feature must improve booking conversion, release confidence, revision efficiency, publish evidence or client retention.

---

## 4. North-star outcomes

### Product north star

**Percentage of listing releases completed and verified without operator intervention.**

### Supporting metrics

- Time from final provider output to realtor-approved release
- First successful download time by device/browser
- Support contacts per 100 deliveries
- Revision rounds and median revision cycle
- Wrong-version or branding escape rate
- False “Verified live” count — target zero
- Percentage of active agents who request Pixel from another photographer
- Booking conversion and average order value
- On-time shoot and delivery SLA rate
- Editing cost, latency, rejection and rework by provider/editor
- Expired or revoked links still accessible — target zero
- Listing-page qualified lead conversion by source, not raw views
- Net revenue retention by photographer/company tenant

---

## 5. Release roadmap

## Release 0 — Freeze the product contract and de-risk infrastructure

**Outcome:** One approved architecture, measurable release boundary and no hidden dependency that invalidates media storage or worker deployment.

### Task 0.1: Add the canonical product strategy document

**Objective:** Replace scattered direction with one authoritative product contract.

**Files:**
- Create: `docs/PRODUCT_STRATEGY.md`
- Reference: `SAAS_PRODUCT_DIRECTION.md`
- Reference: `SPIRO_INSPIRED_UPGRADES.md`
- Reference: Mission Control research under `~/.hermes/apps/mission-control/docs/pixel-booking/`
- Test: `tests/product-strategy-contract.test.mjs`

**Steps:**
1. Write a failing source-contract test asserting the product category, primary buyer, realtor-pull wedges, non-goals and north-star metric.
2. Run `node --test tests/product-strategy-contract.test.mjs`; expect failure because the document is absent.
3. Create `docs/PRODUCT_STRATEGY.md` from Sections 1–4 of this plan.
4. Run the test; expect pass.
5. Commit: `docs: define real estate media OS product strategy`.

### Task 0.2: Inventory media and release execution sinks

**Objective:** Identify every place that downloads, proxies, embeds, persists or deletes external media before introducing canonical storage.

**Files:**
- Create: `docs/MEDIA_EXECUTION_SINK_INVENTORY.md`
- Inspect: `app/api/iguide/download/route.ts`
- Inspect: `lib/integrations/iguide/**`
- Inspect: `lib/integrations/autoenhance/**`
- Inspect: `lib/integrations/fotello/**`
- Inspect: `app/portal/[propertyId]/**`
- Inspect: `app/listings/[slug]/page.tsx`
- Inspect: `app/admin/bookings/[id]/**`
- Test: `tests/media-execution-sink-inventory.test.mjs`

**Steps:**
1. Write a test enumerating known network-fetch, arbitrary-URL persistence, iframe, ZIP proxy and deletion boundaries.
2. Document caller, tenant predicate, URL source, fetch behavior, timeout, size bound, MIME validation, persistence and user exposure for each sink.
3. Classify each as retain/harden, migrate, or retire.
4. Prove no current route is omitted with repository searches in the test fixture.
5. Commit: `docs: inventory media execution boundaries`.

### Task 0.3: Run a canonical-storage spike

**Objective:** Verify R2, Sharp/libvips and a portable container worker against representative real files before schema commitment.

**Files:**
- Create: `spikes/media-worker/package.json`
- Create: `spikes/media-worker/src/spike.ts`
- Create: `spikes/media-worker/Dockerfile`
- Create: `spikes/media-worker/README.md`
- Create: `spikes/media-worker/test/fixtures/README.md`
- Test: `spikes/media-worker/test/spike.test.ts`

**Steps:**
1. Use synthetic/authorized JPEG, TIFF, DNG metadata samples and ZIP fixtures only.
2. Prove bounded streaming upload, multipart output, SHA-256, image decode, orientation normalization, sRGB conversion and deterministic ZIP ordering.
3. Measure memory and duration for representative 50-, 100- and 200-image sets without using customer media.
4. Verify R2 object HEAD/checksum and abort incomplete multipart uploads.
5. Keep all credentials in local/server-only configuration; print no values.
6. Write a go/no-go note selecting the portable worker host and queue/claim model.
7. Delete remote spike objects by exact recorded IDs.
8. Commit only the reusable findings/fixtures, not credentials or temporary outputs.

### Task 0.4: Approve the initial release boundary

**Objective:** Keep Phase 1 small enough to release safely.

**Release 1 includes only:**

- R2 private buckets/environment setup
- Canonical asset/version/release/package schema
- One provider ingestion path (Autoenhance first)
- Full-resolution and provisional Ontario derivative profiles
- Full-resolution and MLS ZIPs
- Authenticated realtor gallery and short-lived download grants
- Migration from one live iGUIDE/Autoenhance delivery path behind a feature flag

**Explicitly excluded:**

- Public self-serve storage configuration for tenants
- Multi-provider automatic routing
- Brokerage procurement
- MLS posting
- Generative editing
- Custom domains
- Full marketing-kit editor
- Universal staging rules

---

## Release 1 — Pixel-owned media and immutable listing releases

**Outcome:** A completed edit becomes a secure Pixel-owned asset set with reproducible full-resolution and destination-profile downloads.

### Task 1.1: Define media domain types and invariants

**Objective:** Create one provider-neutral vocabulary before database or UI work.

**Files:**
- Create: `lib/media/types.ts`
- Create: `lib/media/states.ts`
- Create: `lib/media/profiles.ts`
- Test: `tests/media-domain.test.mjs`

**Required types:**

```ts
export type IngestState =
  | "discovered" | "url_ready" | "fetching" | "quarantined"
  | "validating" | "scanning" | "accepted" | "deriving"
  | "review_pending" | "retryable" | "source_expired"
  | "reconciliation_required" | "rejected" | "dead_letter";

export type ReleaseState =
  | "draft" | "review_pending" | "changes_requested"
  | "revision_processing" | "approved" | "packaging"
  | "ready" | "published" | "superseded" | "withdrawn";

export type DerivativeClass =
  | "master" | "full_res" | "mls" | "web" | "thumbnail";
```

**Steps:**
1. Write state-transition tests first, including forbidden backward mutation of approved/published releases.
2. Implement explicit transition maps, not free-form strings.
3. Add profile capability validation and unknown-value fail-closed behavior.
4. Run `npm test`, `npm run typecheck`, and `npm run lint`.
5. Commit: `feat: define canonical media release domain`.

### Task 1.2: Add the canonical media schema

**Objective:** Persist immutable media identity, provenance, derivatives, releases and packages with tenant-qualified constraints.

**Files:**
- Create: `supabase/migrations/<timestamp>_canonical_media_releases.sql`
- Modify after migration: `lib/supabase/database.types.ts`
- Modify after migration: `supabase/setup.sql`
- Test: `tests/canonical-media-schema.test.mjs`
- Test: `scripts/verify-canonical-media-postgres.sh`

**Tables:**

- `media_batches`
- `media_assets`
- `media_versions`
- `media_derivatives`
- `provider_events`
- `media_ingest_jobs`
- `media_job_attempts`
- `gallery_releases`
- `gallery_release_items`
- `media_packages`
- `download_grants`
- `download_events`
- `listing_gallery_items`

**Required constraints:**

- `organization_id` on every business row
- tenant-qualified composite foreign keys where practical
- immutable object key and SHA-256 after acceptance
- unique provider output identity by tenant/connection/job/output/revision
- one derivative per source-version/profile/profile-version
- one package per release/type/manifest hash
- release items must belong to the same tenant/property/batch as the release
- only approved release items can become listing gallery items
- grants store keyed token hashes, never plaintext tokens

**Release discipline:**
1. Inspect linked remote ledger and dry run.
2. If history diverges, apply only this exact reviewed migration and repair only its version; never use `--include-all`.
3. Execute the migration inside `BEGIN ... ROLLBACK`, apply twice and test idempotency where intended.
4. Prove cross-tenant inserts and release-item references fail.
5. Regenerate `supabase/setup.sql` only for fresh projects.
6. Commit: `feat: add immutable media release schema`.

### Task 1.3: Add R2 storage configuration and strict key builders

**Objective:** Prevent caller-controlled object paths and cross-tenant key drift.

**Files:**
- Create: `lib/media/storage/config.ts`
- Create: `lib/media/storage/keys.ts`
- Create: `lib/media/storage/r2.ts`
- Modify: `.env.example`
- Test: `tests/media-storage-keys.test.mjs`

**Key formats:**

```text
quarantine/{organizationId}/{ingestJobId}/{randomObjectId}
masters/{organizationId}/{assetId}/{versionId}/{sha256}.{ext}
derivatives/{organizationId}/{versionId}/{profileVersion}/{sha256}.{ext}
packages/{organizationId}/{releaseId}/{packageType}/{manifestSha256}.zip
```

**Steps:**
1. Test UUID validation, generated leaf names, traversal rejection and exact environment separation.
2. Add server-only R2 credentials and separate quarantine/master/delivery/public bucket settings.
3. Ensure no client module can import credential-bearing code.
4. Add exact-key HEAD, multipart upload, abort and deletion helpers.
5. Commit: `feat: add private canonical media storage boundary`.

### Task 1.4: Build the durable media-worker claim protocol

**Objective:** Run long media jobs outside Vercel with leases, fencing and bounded retries.

**Files:**
- Create: `workers/media/package.json`
- Create: `workers/media/tsconfig.json`
- Create: `workers/media/Dockerfile`
- Create: `workers/media/src/claim.ts`
- Create: `workers/media/src/worker.ts`
- Create: `workers/media/src/config.ts`
- Create: `workers/media/tests/claim.test.ts`
- Create: `supabase/migrations/<timestamp>_media_job_claim_rpc.sql`

**Steps:**
1. Write PostgreSQL tests for single-claim ownership, lease expiry, stale fencing token, maximum attempts and dead-letter settlement.
2. Add service-role-only claim/settle RPCs with grants revoked from public roles.
3. Use one bounded batch per poll and configurable concurrency defaulting to one.
4. Emit sanitized outcome codes, not raw provider responses.
5. Verify graceful shutdown releases no lease incorrectly; expiry handles worker death.
6. Commit database and worker protocol separately if migration-first rollout requires it.

### Task 1.5: Implement hardened provider-output loading

**Objective:** Fetch provider outputs without SSRF, unbounded allocation or bearer-URL leakage.

**Files:**
- Create: `workers/media/src/egress/url-policy.ts`
- Create: `workers/media/src/egress/dns.ts`
- Create: `workers/media/src/egress/bounded-fetch.ts`
- Create: `workers/media/src/ingest/fetch-output.ts`
- Test: `workers/media/tests/bounded-fetch.test.ts`

**Tests must reject:**

- loopback, RFC1918, link-local and metadata addresses;
- mixed public/private DNS answers;
- DNS family mismatch and rebinding opportunities;
- redirects to forbidden hosts;
- too many redirects;
- oversized declared or streamed bodies;
- unsupported MIME/encoding;
- empty success bodies;
- deadline overrun;
- cross-tenant job/resource mismatch.

**Implementation:**

- HTTPS only
- provider-specific exact host allowlists where possible
- bind sockets to validated IP while preserving Host/TLS SNI
- manual redirect validation
- one total deadline
- streamed byte count and SHA-256
- no full-body `arrayBuffer()`
- sanitize URLs before logs/persistence

**Commit:** `security: add bounded provider media loader`.

### Task 1.6: Add quarantine validation and malware scanning

**Objective:** Promote only decoded, bounded, supported media.

**Files:**
- Create: `workers/media/src/validate/image.ts`
- Create: `workers/media/src/validate/archive.ts`
- Create: `workers/media/src/validate/malware.ts`
- Create: `workers/media/src/validate/provenance.ts`
- Test: `workers/media/tests/validation.test.ts`

**Rules:**

- compare declared MIME, magic bytes, decoder result and extension;
- bound width, height, pixels, frames/pages, bit depth, CPU, memory and wall time;
- reject SVG/HTML/polyglots unless explicitly supported;
- reject ZIP traversal, symlinks, duplicates/confusables, encryption, excessive entries and zip bombs;
- keep scan-pending/rejected assets inaccessible to derivative and delivery paths;
- strip bearer query strings from logs;
- preserve validated master bytes and application SHA-256.

### Task 1.7: Implement deterministic derivative profiles

**Objective:** Generate reproducible full-resolution, Ontario provisional, web and thumbnail outputs.

**Files:**
- Create: `workers/media/src/derive/profile-registry.ts`
- Create: `workers/media/src/derive/image.ts`
- Create: `lib/media/profile-registry.ts`
- Create: `docs/EXPORT_PROFILES.md`
- Test: `workers/media/tests/derivatives.test.ts`

**Initial profiles:**

```text
original.camera.v1
client.fullres.share.v1
ontario.proptx.provisional.2026-08-11.v1
web.listing.320.v1
web.listing.640.v1
web.listing.1280.v1
web.listing.2048.v1
thumbnail.admin.320.v1
```

**Provisional Ontario recipe:**

- JPEG, sRGB
- source aspect ratio preserved
- provisional 2048 px maximum long edge
- quality approximately 88–90
- provisional target below 4 MB
- no branding, people or promotional text
- no materially inaccurate generative edit
- private EXIF/GPS stripped; ICC preserved
- manifest carries rights, disclosures, checksums and profile status

Every UI label must say **Provisional Ontario preset** until a current board specification and real-interface test promote it to `board_verified`.

### Task 1.8: Implement immutable release manifests

**Objective:** Bind approval to exact versions and profile outputs.

**Files:**
- Create: `lib/media/releases/manifest.ts`
- Create: `lib/media/releases/service.ts`
- Test: `tests/media-release-manifest.test.mjs`

**Manifest includes:**

- organization/property/batch/release IDs
- release revision and superseded release
- ordered asset/version IDs
- master, full-res, MLS and web derivative IDs
- dimensions, bytes, MIME and SHA-256
- edit/staging/disclosure class
- rights/consent start/end
- profile names/versions/statuses
- approver and approval timestamp

Canonicalize JSON before hashing. Any asset/order/profile change creates a new manifest and release candidate.

### Task 1.9: Build asynchronous package generation

**Objective:** Prebuild reproducible full-resolution and MLS ZIPs without Vercel memory/time risk.

**Files:**
- Create: `workers/media/src/package/build-zip.ts`
- Create: `workers/media/src/package/manifest.ts`
- Test: `workers/media/tests/package.test.ts`

**Steps:**
1. Stream each object into the ZIP writer and stream output to R2 multipart upload.
2. Use deterministic filenames/order and include `manifest.json` plus optional CSV.
3. Hash package bytes and ordered manifest.
4. HEAD/checksum before marking ready.
5. Reuse package when release/type/manifest hash matches.
6. Abort and reconcile ambiguous multipart outcomes.

### Task 1.10: Add revocable download grants

**Objective:** Authorize every download through Pixel before issuing a short-lived object capability.

**Files:**
- Create: `lib/media/downloads/grants.ts`
- Create: `app/d/[token]/route.ts`
- Create: `app/api/media/packages/[packageId]/grant/route.ts`
- Test: `tests/media-download-grants.test.mjs`

**Contract:**

```text
GET /d/{opaqueToken}
→ hash token
→ tenant/principal/release/package lookup
→ check active, expiry, max downloads, payment and release state
→ atomically log/consume resolution
→ issue 30–60 second R2 GetObject URL
→ 302 redirect
```

A grant-resolution event proves authorization/issuance, not full browser receipt. Label analytics honestly.

### Task 1.11: Migrate one provider flow behind a feature flag

**Objective:** Prove Autoenhance completed outputs can become Pixel-owned releases while retaining current production delivery as fallback.

**Files:**
- Modify: `lib/integrations/autoenhance/workflow.ts`
- Modify: `app/api/integrations/autoenhance/webhook/route.ts`
- Create: `lib/media/providers/autoenhance.ts`
- Modify: `app/admin/settings/integrations/**`
- Test: `tests/autoenhance-media-ingest.test.mjs`

**Rules:**

- webhook only records/deduplicates and enqueues;
- deterministic provider output identity;
- current iGUIDE path remains unchanged when flag is off;
- no customer is switched until synthetic and authorized pilot evidence passes;
- reconciliation poller remains authoritative.

---

## Release 2 — Realtor gallery and mobile-safe delivery

**Outcome:** Realtors receive one polished property workspace with individual and bulk downloads, release state and durable history.

### Task 2.1: Replace arbitrary gallery URLs with release items

**Files:**
- Modify: `app/portal/[propertyId]/page.tsx`
- Modify: `app/listings/[slug]/page.tsx`
- Modify: `app/portal/[propertyId]/ListingWebsiteEditor.tsx`
- Modify: `app/portal/[propertyId]/listing-website-actions.ts`
- Test: `tests/release-backed-gallery.test.mjs`

Do not delete legacy columns until all callers read approved release IDs. Add compatibility reads only for properties without a migrated release.

### Task 2.2: Build the realtor gallery UI

**Files:**
- Create: `app/portal/[propertyId]/MediaGallery.tsx`
- Create: `app/portal/[propertyId]/MediaAssetCard.tsx`
- Create: `app/portal/[propertyId]/ReleaseStatus.tsx`
- Create: `app/portal/[propertyId]/DownloadPanel.tsx`
- Test: `tests/realtor-gallery-ui.test.mjs`
- Browser test: `tests/browser/realtor-gallery.spec.ts`

**Required behavior:**

- full-res, MLS-profile, individual, selected and all-media actions;
- visible dimensions/type/size/profile status;
- no download button before release/package readiness;
- mobile direct-save path where supported;
- in-app-browser warning/handoff;
- keyboard, focus, reduced-motion and non-color status support;
- no clipped controls at 320, 390, 768 and 1440 px.

### Task 2.3: Add payment-gated release

**Files:**
- Create: `lib/media/releases/payment-policy.ts`
- Modify: `app/portal/[propertyId]/page.tsx`
- Modify: QuickBooks status refresh/outbox consumers under `lib/integrations/quickbooks/**`
- Test: `tests/release-payment-gate.test.mjs`

Preview may remain watermarked while locked. Unlock must be atomic and idempotent; a transient QuickBooks error is `unknown/needs attention`, not unpaid.

### Task 2.4: Add delivery/open/download activity

**Files:**
- Create: `app/admin/bookings/[id]/MediaDeliveryActivity.tsx`
- Create: `app/portal/[propertyId]/DownloadHistory.tsx`
- Create: `lib/media/downloads/events.ts`
- Test: `tests/download-activity.test.mjs`

Distinguish email sent/opened, grant resolved, URL issued and controlled proxy completion. Never claim full-byte completion from a redirect alone.

### Task 2.5: Retire request-time provider ZIP proxying

**Files:**
- Modify or retire: `app/api/iguide/download/route.ts`
- Modify: `lib/integrations/iguide/sync.ts`
- Test: `tests/iguide-download-retirement.test.mjs`

Once migrated releases exist, new iGUIDE ZIPs must enqueue ingestion and download from Pixel packages. Keep only a bounded compatibility route for unmigrated historical properties, then remove it after measured zero use.

---

## Release 3 — Structured proofing, revisions and QC

**Outcome:** Revision work becomes explicit, attributable, billable and auditable.

### Task 3.1: Add revision schema

**Tables:**

- `revision_requests`
- `revision_annotations`
- `revision_entitlements`
- `approval_decisions`
- `revision_events`

**Files:**
- Create: `supabase/migrations/<timestamp>_structured_media_revisions.sql`
- Test: `scripts/verify-media-revisions-postgres.sh`

### Task 3.2: Add favourites and categorized annotations

**Files:**
- Create: `app/portal/[propertyId]/RevisionPanel.tsx`
- Create: `app/portal/[propertyId]/ImageAnnotation.tsx`
- Create: `app/portal/[propertyId]/revision-actions.ts`
- Test: `tests/revision-annotations.test.mjs`

Categories: editing correction, remove/replace, reorder, MLS/branding concern, new paid request.

### Task 3.3: Add revision entitlement and quote policy

**Files:**
- Create: `lib/media/revisions/policy.ts`
- Create: `app/admin/bookings/[id]/RevisionQueue.tsx`
- Test: `tests/revision-entitlement.test.mjs`

Package rules decide included versus chargeable; ambiguous cases require operator decision. Never auto-charge from a model-generated classification.

### Task 3.4: Add replacement lineage and realtor reapproval

A resolved annotation must point to the replacement version or an explicit explanation. A revision creates a new candidate release; the prior approved release remains immutable and accessible to authorized operators.

### Task 3.5: Add technical QC

**Files:**
- Create: `workers/media/src/qc/technical.ts`
- Create: `lib/media/qc/findings.ts`
- Create: `app/admin/bookings/[id]/MediaQcPanel.tsx`
- Test: `workers/media/tests/technical-qc.test.ts`

Start with deterministic checks: decode, dimensions, aspect, ICC, orientation, bytes, duplicates, count reconciliation, GPS/private metadata, required derivatives and package membership. Add advisory AI QC only after corpus validation.

### Task 3.6: Pilot Restb.ai advisory QC

No finding may automatically reject, bill, withhold or publish. Store model/taxonomy version, confidence and reviewer disposition. Promotion requires measured precision/recall on a 600-image authorized corpus and written multi-tenant terms.

---

## Release 4 — Editing provider orchestration

**Outcome:** Photographers choose the right editing lane without changing the Pixel workflow.

### Task 4.1: Define provider adapter contract

**Files:**
- Create: `lib/media/providers/contract.ts`
- Create: `lib/media/providers/capabilities.ts`
- Test: `tests/provider-capability-negotiation.test.mjs`

**Contract operations:**

- quote/estimate where supported
- create job/order
- upload/presigned upload/URL handoff
- submit
- get status
- refresh result URLs
- fetch outputs
- request revision
- cancel where supported
- usage/cost retrieval
- webhook verify/dedupe
- reconciliation

Unsupported capabilities return typed `unsupported`; never silently drop requested HDR, revision, resolution or disclosure options.

### Task 4.2: Harden Autoenhance

- pin tested API date/version;
- migrate legacy sky controls;
- deterministic IDs and local mutation ledger;
- webhook dedupe plus polling;
- archive/result ingestion within 24-hour SLO;
- reprocess/report support after contract tests;
- written white-label/no-training/commercial terms.

### Task 4.3: Add Imagen full-resolution HDR

Use the profile-based real-estate flow, not lower-resolution Smart Editing. Ingest temporary exports immediately. Treat callbacks as hints. Copilot revisions come after the core export path.

### Task 4.4: Contract and pilot PhotoUp

PhotoUp is the preferred managed HDR/flambient/manual editing candidate if the agreement grants multi-tenant OEM/resale, data handling, retention, output access, revision entitlement and SLA rights.

### Task 4.5: Add managed-editor failover

Evaluate Styldod only after state vocabulary, revision path, output TTL, webhook trust and commercial terms are stable. Add BoxBrownie later for quoted specialty jobs, not as the core editor.

### Task 4.6: Add Apply Design staging under disclosure controls

Every staged output requires:

- immutable original association;
- visible `VIRTUALLY STAGED` status in Pixel;
- configurable destination disclosure/pairing;
- human approval;
- no auto-publish;
- OEM/no-training/deletion contract.

### Task 4.7: Keep blocked providers blocked

- Fotello remains gated until current private specification, auth, durable outputs and OEM rights are secured.
- AutoHDR receives no implementation sprint until supported API docs, sandbox, pricing and resale terms exist.
- Photoroom remains marketing-derivative only.
- Cloudinary/Cloudflare transforms remain infrastructure, not property-truth editors.

### Task 4.8: Add provider scorecards

Track cost, latency, completion, missing outputs, QC failure, revision rate, accepted quality and operator intervention by provider/editor/service. Routing recommendations remain advisory until sample size and contracts support automation.

---

## Release 5 — Realtor-demand coordination and exception handling

**Outcome:** Pixel prevents the expensive mistakes that booking calendars ignore.

### Task 5.1: Verified access and shoot-readiness handoff

**Data:** access method, lockbox/contact, occupant/pet, parking/elevator, readiness checklist, seller/tenant consent, confirmation actor/time, exception state.

**UI:** realtor confirms readiness; photographer sees one field-ready brief; unresolved access blocks “ready for shoot” but not record creation.

### Task 5.2: Living shot brief and scope acceptance

Include services, hero priorities, must-have rooms/views, exclusions, occupancy/staging state, branding/disclosure constraints, appointment constraints and accepted revision number. Scope changes after acceptance create a change request.

### Task 5.3: Structured rush/change orders

A request has price/SLA impact, approver, accepted/rejected state, invoice linkage and operational timeline. No silent text-message scope creep.

### Task 5.4: Constraint-aware scheduling

Model photographer skills/equipment, service duration, geography/travel, weather/drone constraints, access windows, property readiness and team capacity. Start with warnings and operator suggestions; do not auto-reassign until historical tests prove safety.

### Task 5.5: Exception command centre

First-class queues for access failure, weather, reshoot, late editor, missing output, count mismatch, QC failure, unpaid release, rights expiry, failed publish and stale destination version.

Every exception needs owner, SLA, next action, escalation and customer-visible status where appropriate.

---

## Release 6 — Listing pages, marketing and publish verification

**Outcome:** One approved release powers every page and destination with truthful status.

### Task 6.1: Bind property pages to approved releases

Modify `app/listings/[slug]/page.tsx` so it joins only explicitly selected approved release items. Remove discovery of arbitrary property deliverable URLs after compatibility migration.

### Task 6.2: Separate branded and MLS-safe policies

Branded page:

- agent/team and required brokerage identity;
- lead form, consent, analytics and social metadata;
- rights/consent effective and expiry dates;
- immediate withdrawal controls.

MLS-safe page:

- no photographer promotion, agent contact, lead capture or cross-selling unless board-approved;
- retain legally required brokerage attribution;
- direct, stable HTTPS media/tour URLs;
- automated branding/contact preflight.

### Task 6.3: Add versioned destination-policy registry

**Files:**
- Create: `lib/destinations/profiles.ts`
- Create: `docs/DESTINATION_POLICY.md`
- Create: `app/admin/settings/destinations/**`
- Test: `tests/destination-profiles.test.mjs`

Profiles move from `provisional` to `board_verified` only with dated first-party evidence and real-interface receipts. Unknown required fields fail closed.

### Task 6.4: Add listing-page analytics and leads

Track consented views, unique visitors, referrers, popular media, CTA conversions and qualified leads. Avoid vanity-first dashboards. Provide seller/realtor summaries that lead to a decision or action.

### Task 6.5: Add social derivatives

Generate square, portrait and landscape assets from approved release media. No full design editor initially. Include template/version/provenance and accessibility text.

### Task 6.6: Add publish receipt model

**States:** prepared, submitted, accepted, live, mismatch, removed, unknown, unsupported, error.

Store release/profile version, request time, actor, external ID/URL, provider response class and verification evidence. Never persist `live` from browser storage or request acceptance.

### Task 6.7: Pilot one authorized destination

Start with Pixel-hosted branded/MLS-safe pages or one contractually authorized external channel. Inject dropped, duplicated, delayed and out-of-order events. Exit requirement: at least 99% terminal reconciliation and zero false “Verified live.”

---

## Release 7 — Brokerage operating layer

**Outcome:** Brokerages create demand and governance while photographers retain portable operating value.

### Task 7.1: Add brokerage/team accounts

Model brokerage, team, offices, agent membership, approved vendor relationships and role-specific access without merging unrelated photographer tenants.

### Task 7.2: Add approved-vendor and service-standard policies

Brokerages can define approved media companies, required packages, turnaround, destination profiles, disclosure rules and release approvals. Photographers see actionable requirements before accepting the job.

### Task 7.3: Add budgets and consolidated billing

Support property/agent/team budgets, purchase authorization, billing responsibility, consolidated statements and exceptions. Preserve invoice snapshots and QuickBooks reconciliation.

### Task 7.4: Add vendor portability

Authorized assets and manifests can move with the property/realtor under rights rules without exposing one photographer’s private operations or credentials. Export includes versions, checksums, rights and release history.

### Task 7.5: Add brokerage dashboard

Focus on exceptions, SLA, spend, release status, policy violations and destination mismatches—not generic charts.

---

## Release 8 — Sellable SaaS and growth engine

**Outcome:** Another photography business can onboard, configure, operate and pay without Michael manually rebuilding the tenant.

### Task 8.1: Finalize tenant onboarding

- invite-only beta first;
- company identity and domain;
- owner/admin membership;
- catalog/package templates;
- availability/service area;
- email/domain verification;
- integrations readiness;
- sample/demo listing separate from customer data;
- activation gate after checklist verification.

### Task 8.2: Add platform subscription billing

Suggested packaging to validate, not hard-code prematurely:

- **Starter:** booking, portal, property archive, basic delivery
- **Pro:** canonical gallery/releases, editing integrations, QuickBooks, custom branding/domain, marketing pages
- **Studio:** teams, advanced automations, provider routing, analytics, brokerage relationships
- Usage charges: storage, egress-sensitive operations, AI/editing credits and optional premium publishing

Implement entitlement checks at server boundaries; UI hiding is not authorization.

### Task 8.3: Add integration readiness truth

Every integration reports:

- configured;
- connected;
- ready for the complete workflow;
- needs attention;
- unavailable.

A credential row alone is not readiness. Validate mappings, permissions, webhooks and a bounded provider read.

### Task 8.4: Add guided migration/import

Import realtors, properties, future bookings and durable media only through bounded, tenant-safe processes. Do not bulk-import arbitrary external URLs without canonicalization and rehosting.

### Task 8.5: Add help, onboarding and operational playbooks

Document booking setup, delivery/release semantics, destination profiles, provider contracts, permissions, incident handling, data export/deletion and customer support boundaries.

### Task 8.6: Add tenant health and support tooling

Platform-only view for migration state, outbox/media dead letters, storage reconciliation, integration readiness, release failures and support correlation IDs. Never expose secrets or raw provider bodies.

### Task 8.7: Run design-partner beta

Recruit a small mix of solo photographers, teams and realtor/brokerage users. Do not scale acquisition until first delivery, revision, download and listing release work without Michael’s direct intervention.

---

## 6. Commercial positioning

### Category statement

**Pixel Blaster is the listing release command centre for real-estate media teams and the realtors they serve.**

### Lead promises

1. Every property is shoot-ready before the photographer arrives.
2. Every edit, revision and approval stays attached to the correct listing.
3. Realtors receive the right files for the right destination.
4. Branded and MLS-safe pages come from the same approved media release.
5. “Published” means verified, not merely sent.

### Do not lead with

- all-in-one;
- prettier galleries;
- generic CRM;
- AI captions;
- property-page templates;
- universal MLS compliance;
- raw page views;
- favorites/comments alone.

### Pricing validation

Test value-based packaging against avoided admin time, increased order value, lower revision/support cost, faster release and brokerage access. Do not finalize price from competitor parity alone.

---

## 7. Ontario/Canadian policy track

### Required diligence before board-verified export

1. Obtain current PropTx/TRREB/board Matrix upload requirements.
2. Confirm formats, dimensions, bytes, aspect handling, count, primary image, filenames and metadata.
3. Confirm signs, logos, watermarks, people, floor plans, aerials, renderings, staging, decluttering, object removal, sky/twilight, lawn, window/view and generative edits.
4. Confirm disclosure labels, original/staged pairing and remarks wording.
5. Confirm branded/unbranded tour fields, approved hosts, redirects, query strings, lead forms and syndication.
6. Test representative files in the real interface.
7. Save accepted/rejected files, screenshots, dimensions, checksums, support references and effective dates with the profile version.
8. Obtain brokerage review for branded and MLS-safe templates.
9. Record seller/tenant, brokerage and photographer consent periods and takedown SLA.
10. Reverify profiles on a schedule and deprecate superseded rules without mutating past release receipts.

---

## 8. Security, privacy and reliability programme

Every release must include applicable tests for:

- authentication and role authorization;
- organization/property/resource ownership in the same query predicate;
- RLS plus service-role boundary review;
- credential isolation and encryption-reader inventory;
- SSRF, redirects, DNS rebinding and metadata destinations;
- request/body/file/byte/pixel/archive limits;
- provider timeouts, retries, idempotency and ambiguity;
- raw webhook signatures, replay and deduplication;
- output MIME/content/shape validation;
- object-store compensation and orphan reconciliation;
- immutable checksums and release lineage;
- payment/release atomicity;
- revoked/expired download grants;
- public listing withdrawal and cache behavior;
- rights/consent expiry;
- cross-tenant provider identities and webhook routing;
- accessibility, responsive geometry and mobile download behavior;
- migration-first production rollout and exact ledger verification.

Never run destructive production canaries without cleanup-first exact-ID handles and proof of zero residue.

---

## 9. Test and release protocol

For every code task:

1. Write the narrow failing test.
2. Run it and observe the expected failure.
3. Implement the smallest passing behavior.
4. Run the focused test.
5. Run full gates:

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

6. For database changes:

```bash
supabase migration list --linked
supabase db push --linked --dry-run
```

The dry run must name exactly the reviewed pending migration. With ledger divergence, use the approved exact-migration path and repair only that version.

7. For UI changes, verify route-specific rendered content and geometry at:

- 320 × 760
- 390 × 844
- 768 × 1024
- 1440 × 1000

Assert document width, visible element bounds, keyboard flow, focus, loading, error and partial-success states.

8. Stage only intended files, run `git diff --cached --check`, record the exact staged hash and obtain independent security/logic/UX review for high-risk slices.
9. Deploy migration-first where application code depends on schema.
10. Verify the exact deployment artifact, health endpoint, route behavior and fresh logs.
11. Keep the new behavior behind a fail-closed tenant feature flag until supervised evidence passes.
12. Commit in small, reversible slices.

---

## 10. Rollout order and gates

### Gate A — Infrastructure proof

- R2 and worker spike passes representative limits.
- Cost model uses expected object count, stored GB, package egress and operation volume.
- Data location, DPA, retention and support access are accepted.

### Gate B — Internal synthetic release

- Synthetic assets ingest, validate, derive, package and download.
- No customer data.
- Fault injection proves retries, dead letters, duplicate events, ambiguous storage and compensation.

### Gate C — Pixel authorized pilot

- Exact Pixel listings selected by Michael.
- Current delivery remains fallback.
- Compare file count, dimensions, quality, checksums, gallery usability and support effort.

### Gate D — Sharp Canada/existing external beta tenant

- Use only authorized tenant accounts and credentials.
- Confirm isolation, onboarding, branding, exports, provider usage and billing.
- Do not use Michael’s personal identity for marketplace or seller-account validation.

### Gate E — Design-partner beta

- Multiple photography companies and realtors.
- Measure first-time setup, booking, release, download, revision and support.

### Gate F — Brokerage pilot

- One brokerage/team with explicit standards, permissions and consent.
- No MLS posting claim until authorized destination profile and connector verification pass.

---

## 11. Stop conditions

Pause or remove a feature when:

- more than 10% of users need manual help for normal mobile delivery;
- revision users continue using email/text for more than 60% of revision jobs;
- destination preflight false alarms exceed 5% and cause routine bypass;
- any false “Verified live” state occurs;
- a provider cannot grant written multi-tenant/OEM processing rights;
- result URLs cannot be durably ingested before expiry;
- cost per release is not measurable or controllable;
- a board rule cannot be sourced but the UI implies verified compliance;
- cross-tenant ownership cannot be proven in one authoritative query path;
- migration dry run or live schema does not match the reviewed artifact.

---

## 12. Immediate implementation queue

Execute in this order:

1. Task 0.1 — canonical product strategy
2. Task 0.2 — media execution-sink inventory
3. Task 0.3 — R2/Sharp/container spike
4. Task 0.4 — approve Release 1 boundary
5. Task 1.1 — media domain types/state tests
6. Task 1.2 — canonical media schema
7. Task 1.3 — storage/key boundary
8. Task 1.4 — durable worker claims
9. Task 1.5 — hardened provider loader
10. Task 1.6 — quarantine/validation
11. Task 1.7 — deterministic derivatives
12. Task 1.8 — release manifests
13. Task 1.9 — ZIP packages
14. Task 1.10 — download grants
15. Task 1.11 — Autoenhance pilot connector
16. Release 1 end-to-end synthetic and authorized Pixel pilot
17. Begin Release 2 only after Release 1 metrics and rollback evidence pass

---

## 13. Definition of “best SaaS system”

Pixel is ready to claim category leadership only when it can prove all of the following:

- A new photography business can onboard without platform-owner intervention.
- A realtor can book, prepare, approve, download and publish from one property timeline.
- Editing providers can change without changing the client workflow or losing media identity.
- Every delivered file has provenance, version, checksum, profile and approval evidence.
- Full-resolution and destination-specific packages are reproducible.
- A withdrawn or revoked release stops future authorized access within the documented SLA.
- Branded and MLS-safe outputs are generated from the same immutable release.
- Destination status distinguishes sent, accepted, verified live, mismatch and unknown.
- Exceptions are owned and recoverable rather than buried in email.
- Cross-tenant isolation and provider routing are proven behaviorally.
- The product measurably reduces support/revision effort and increases realtor repeat preference.
- The business model supports storage, provider, worker, support and compliance costs at target margins.

This is the standard. Feature count alone does not make the best product; reliable listing release outcomes do.
