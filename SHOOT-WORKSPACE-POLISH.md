# Shoot workspace polish — inventory and boundary

Base: fresh origin/main `af534fb0542b3c9e8d9fd1747bbd83408b0d2e00`. Candidate only; no production operations or release.

## Real inventory (before implementation)

`booking/app/admin/bookings/[id]/page.tsx` loads the authorized organization booking, catalog, deliverables, iGUIDE job, provider enablement, website, private notes and latest delivery notification. `BOOKING_STATUSES` owns lifecycle labels and available transitions. Ready-links summary counts non-Fotello deliverable records with `ready_at`; it is not a production-completion count. Photo-package presence uses iGUIDE ZIP syntax checks; delivery preview uses `buildDeliveryLinks` over ready records. Preserve these rules, not reinterpret them visually.

- **Header:** address, schedule, lifecycle pill, bookings return; delivery-tab link, call, email, map, conditional cancellation, reschedule deep link, Today. Summary includes ready-record count, realtor/contact links and services/Details link. No action may disappear in this polish.
- **Media:** neutral planned Upload/Review/Prepare/Ready flow; canonical JPG upload is explicitly unavailable, without picker. iGUIDE package presence changes primary-source copy. AutoHDR panel is enablement-gated and integration-gated (not a functioning upload). Source disclosure contains real iGUIDE save/clear/create/link existing/sync and manual MLS/full-resolution links; controls depend on portal credentials, existing IDs and pending state. Enabled Autoenhance has real files/mode/options, upload/enhance, batch refresh and iGUIDE transfer workflow; this is distinct from unavailable canonical upload. Video/manual disclosure retains branded/unbranded video forms and manual deliverable add/delete. Fotello component exists but is not mounted; Fotello deliverables are excluded here.
- **Website:** existing template choice, slug/headline/copy/features, hero/gallery selections, media-section choices, agent/CTA fields, publish state and save. Hero options derive from existing deliverable metadata/thumbnails/images, not an approval ledger. Preserve selector state and source rules.
- **Delivery:** recipient/CC summary, extra recipients, send/resend, timestamp and server errors/billing warnings; client button gates on pending/missing primary email, server action remains authoritative. Grouped real delivery-link preview and conditional agent reminder. Header CTA navigates here; it does not send. No new ready/completed claim.
- **Details:** reschedule anchor/form; invoice disclosure with create/refresh/reconciliation/adoption controls; complete booking edit form; allowed lifecycle transitions; realtor/property/services facts; realtor and private notes with revision/draft behavior. Legacy `?tab=billing` maps to Details. All retained.

## Approved demo comparison and concise gaps

The approved photographer demo uses flat compact identity, quiet silver/white outer panels, blue actions, 44px controls, and property-first hierarchy. It simulates originals → editing → optional Lightroom → finals, independent iGUIDE and later video. These stages are **not** a production integration specification. The real page currently spends excessive phone height on a title card, nested summary cards and two-row tabs; neutral future-flow tiles compete with real work. Existing full body controls are useful but outer surfaces are inconsistent.

Smallest useful change: presentation-only markers/CSS on the shoot workspace, compact flat heading, a consolidated summary surface, a single four-column tab row, quieter planned-flow tiles and coherent restrained outer-panel corners. Keep every control and field. Rename only the header navigation label from “Send delivery” to “Review delivery” to distinguish navigation from the actual send action. No invented next-step engine.

## Deferred functional gaps — not changed

Canonical upload/review/approval/package orchestration is not live in this screen. Originals vs returned edits vs approved finals and optional Lightroom are not modeled here. Provider preference copy predates provider-agnostic direction; do not silently change enabled workflows. iGUIDE package presence is not proof of complete photo production, and delivered photos must not be relabeled overall completion when video is outstanding. Website source selection is not an approved-finals contract. Completing any of these requires separately scoped backend/state work, not this polish.

## Verification plan

Compile before/after actual server page + real client tab bodies with fictional read-only DB/auth boundaries and throwing actions, denied fetch/CSP, no credentials. Capture all four tabs expanded at 320/390/768/1440; compare control inventories and hrefs, layout/overflow, default/custom palettes and deep links. Fixtures do not prove authenticated production E2E, provider operations, delivery, booking changes or physical Safari. Run focused RED/GREEN, full repository tests, lint, types, build, exact presentation boundary and diff check. Parent performs independent review/release.

## Candidate verification completed

- Actual page/layout and all four real tab bodies were compiled before/after; source, video/manual-links and invoice disclosures expanded. Screenshots and geometry: 320, 390, 768 and 1440px. No document overflow or out-of-viewport expanded body descendants in the tested default fixture.
- Tab-content top moved from 803→676px at 320, 717→606px at 390, 473→433px at 768 and 423→377px at 1440. Four tabs remain in one row with at least 44px height. Header actions and disclosures have at least 44px height; existing inner form control sizes are not broadly redesigned.
- Ordered before/after control inventories match: Media 61, Website 47, Delivery 25, Details 50 (includes shared navigation and expanded controls). Exact hrefs, field names/types and disabled states preserved; only the approved header navigation label is normalized in comparison.
- Before/after body text, lifecycle labels and active default/custom tenant primary colors match. Additional fictional cases: no media, missing email, cancelled booking, iGUIDE photos with pending ordered video, long identity. Pending video fixture remains Confirmed rather than being relabeled complete. Local tab navigation, legacy Billing alias, reschedule hash and real template radio selection pass.
- Browser RED captured the original raised title card; final GREEN passes every tab/width case. Explicit real send handler hits the throwing action boundary, with no fetch. Other QA cases invoke no actions/fetches. Read-only server GET/HEAD allowlist and mutation/API denial probes pass; resolved-module audit excludes real action execution, API routes, middleware and Supabase server implementation.
- Root tests **597/597**, private-notes UI **5/5**, invoice unit tests **16/16**, lint, typecheck, production build and `git diff --check` pass. Frozen source-boundary tests prove the three TSX files differ only by the six exact presentation markers and one navigation label. Historical precision boundary is extended only for those exact additions; CSS display exceptions allow only two exact shoot selectors/values.

### Evidence / rerun

Local evidence root: `/Users/PlatoTheBot/.hermes/audits/pixel-shoot-workspace/`.

- `before-after-phone.png`, `before-after-desktop.png`, `bottom-phone-board.png`.
- `media-board.png`, `website-board.png`, `delivery-board.png`, `details-board.png`; complete original-resolution files in `screenshots/{before,after}-{tab}-{320,390,768,1440}-{top,expanded}.png` and candidate `*-bottom.png`.
- `before-results.json`, `after-results.json`, `before-after-comparison.json`, `interaction-results.json`, `safety-verification.json`, `evidence-sha256.json`, per-build resolved `manifest.json`, all command logs.
- Harness files: `build.mjs`, `app.tsx`, `data.ts`, throwing action aliases in build plugin, navigation/assistant/address boundaries, `server.mjs`, `qa.mjs`, `interactions.mjs`. Frozen tracked base in `baseline/booking`.
- In the audit directory: `FIXTURE_VARIANT=before FIXTURE_SOURCE="$PWD/baseline/booking" node build.mjs`; `FIXTURE_VARIANT=after node build.mjs`; `node server.mjs` (localhost 4391); `VARIANT=before node qa.mjs`; `CHECK_POLISH=1 node qa.mjs`; `node interactions.mjs`. Build/server were run with environment allowlisting, not an OS network sandbox.

### Limitations / encountered issues

No authenticated live page, physical iPhone/Safari, production permission evaluation, persistence, delivery/email, provider job, database integration or storage test was exercised. These are actual-component fixtures, not production E2E. Autoenhance empty-batch UI and ordinary invoice state are covered, not every conditional provider/reconciliation panel. Provider tour-picker reads are intentionally denied by the action boundary. Existing inner provider forms, duplicated contact actions and readiness-count wording remain; a separate workflow/content pass can address them without conflating this polish with backend completion.

Playwright's default bundled browser was unavailable; installed Chrome was used. Initial Turbopack build rejected a shared node_modules symlink; isolated local dependency copy fixed it and normal `npm run build` passed. Existing middleware→proxy deprecation warning remains. Independent review and all push/merge/deploy steps remain with the parent; this candidate is not released.
