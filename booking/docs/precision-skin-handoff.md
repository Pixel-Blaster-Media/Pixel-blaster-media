# Precision application skin — review handoff

Status: local presentation candidate. **Not a production release approval.** No push, PR, merge or deployment performed by the implementer.

## Scope and selector inventory

- `app/precision-skin.css`, imported after the unchanged `globals.css`, is gated by `.pixel-app-skin` on `/book`, `/portal`, `/admin` route layouts.
- `body:has(.pixel-app-skin)` supplies the matching backdrop/header/footer tokens only while an opted-in route is present. Root layout has no skin class. Marketing project, auth routes, app landing page and public listing websites do not opt in.
- Shared `realtor-*` panel/choice/field classes receive the silver/white/blue treatment. Existing selected classes own blue outlines; no selection logic changed.
- Outer `section/article/fieldset` panels, dialogs and explicitly marked `precision-panel` wrappers use 6px corners. Fields/buttons/pills/date cells retain softer geometry. Explicit markers cover booking total, calendar timeline wrappers and job tab shell.
- No new display/visibility/overflow/position/z-index/pointer-event rules. No global Tailwind color/radius rewrite. Danger/error/status classes and connected-calendar source styles are not targeted. Existing `globals.css` semantic exceptions remain unchanged.
- Product primary/hover/dark control tokens intentionally override legacy inline organization control colors within these routes. Names, logos, accent tokens, saved brand settings and branding functions are unchanged. **Reviewer should explicitly approve uniform product-blue controls for custom-branded tenants.**

## Behavior boundary

Seven existing TSX files changed only by adding `pixel-app-skin`, `precision-panel`, or the CSS import. A byte comparison against base `3039dbc357f78b3c9a97d5dbe1d5c0c54785f85f`, after removing those exact additions, passed for every file (`boundary-proof.json`).

No pricing/catalog rules, booking state/actions/validation, calendar handlers, authentication, payment, media/provider modules, DB schemas/migrations, middleware, configuration or dependencies changed. Existing sticky booking total remains sticky—not the demo's fixed dock. Existing calendar remains Sunday-first, desktop Week, mobile Day with all original controls, source colors, pointer handling and service/block editors.

## Validation performed

- RED → GREEN source contracts: route opt-in, scoped selectors, no behavior/semantic overrides, explicit panel wrappers, dialog corners.
- Booking suite: **591 passed, 0 failed**. Root marketing/proxy suite: **5 passed, 0 failed**.
- `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`: exit 0.
- Build emits the existing middleware convention deprecation and `admin verification unavailable` during credential-free prerendering. No backend repair attempted.
- Chromium real-component fixture comparison: 48 cases (6 surfaces × before/after × 320/390/768/1440). No document overflow, JS exceptions, external request attempts, changed visible-control counts or bottom-total tap misses.
- Real server-rendered portal home/property-media markup: 16 further before/after cases at the same widths. No document overflow, broken fixture images, JS exceptions, external request attempts or changed control counts.
- Calendar Day/Agenda switching, booking detail/date disclosure, blocked-time editor, mobile tools opened without submission at all four widths. Package selection/deselection and scheduling date/time URL updates exercised; organization parameter preserved; total unmounted after deselection.
- Actual desktop pointer-drag ghost exercised before/after. Browser context closed **before pointer-up**; no reschedule mutation invoked.
- Focused property textarea + bottom-scroll total hit-testing at 320/390 × 568px passed.
- Token contrast calculations: white/primary 5.38:1, white/hover 6.57:1, muted/white 6.25:1, text/silver 15.02:1. These are token checks, not an exhaustive accessibility audit of every inherited status combination.

## Coverage boundaries — do not call this live E2E

| Surface | Evidence | Remaining gate |
| --- | --- | --- |
| Booking services | Actual PackageAccordion/Total/Stepper + actual BookLayout, fictional catalog | Live tenant offerings and sample viewer content |
| Property | Actual PropertyForm; address provider replaced by plain fixture field | Real Places, physical iOS keyboard, tenant-specific overage extremes |
| Schedule | Actual CalendarPicker with fictional slots, actual total | Live availability and calendar provider loading |
| Confirm | Actual ConfirmForm initial contact section | Full server review summary/upsells, account verification, success/receipt, no booking submitted |
| Realtor home | Actual PortalIndex server-rendered with fictional property/read-only DB boundary | Authenticated header and hydrated archive/navigation actions |
| Property media | Actual property page server-rendered with placeholder image and pending photo ZIP state | Ready iGUIDE ZIPs, tours/video, downloads, listing editor and authenticated hydration |
| Operator calendar | Actual CalendarWeekView and AdminBottomNav; navigation/action/autocomplete boundaries replaced | Authenticated source menu, Google data, persisted drag/block/service edits, device/Safari gestures |
| Operator job | Actual BookingWorkspaceTabs and bottom nav; labeled placeholder tab bodies | Full MediaWorkflow/invoice/website/delivery/details content must receive read-only authenticated review |

The production CSS applies across those real routes, but **full operator job and booking confirmation route coverage is not established by these fixtures**. No fixtures or demo runtime are in production source. No live credentials copied; no authenticated mutation performed. Harnesses are localhost-only with route/method allowlists and CSP `connect-src 'none'; form-action 'none'`; browser request interception also rejects off-origin requests. This is not an OS network sandbox.

## Evidence and reproduction

Evidence directory: `/Users/PlatoTheBot/.hermes/audits/pixel-precision-app-skin/`

- `screenshots/`: 102 PNGs including before/after, bottom viewports, details/tools/block editors, drag previews and short-phone tests.
- `visual-results.json`, `ssr-visual-results.json`, `interaction-results.json`, `advanced-results.json`.
- `module-manifest.json`, `ssr-manifest.json`: resolved module inventories; allowlisted production components only, explicit boundary substitutes.
- `boundary-proof.json`; `logs/pixel-skin-{tests,root-tests,lint,types,build,red-panels,red-dialog}.log`.
- External harness scripts: `build.mjs`, `server.mjs`, `qa.mjs`, `interactions.mjs`, `advanced.mjs`; `build-ssr.mjs`, `ssr.tsx`, `server-ssr.mjs`, `qa-ssr.mjs`.
- Local read-only harness ports: 4379 component, 4380 SSR. Dependency paths are workstation-local; not shipped as repository tooling.

## Parent review/release instructions

1. Independently inspect the exact commit and CSS cascade, especially custom tenant branding and untouched semantic colors. `codex` CLI is unavailable and this subagent has no delegate-review tool; **independent review is pending**. Commit is deliberately not marked `[verified]`.
2. Complete the read-only authenticated coverage gates above, checking all operator job tabs and complete booking confirm/success shells on phone and desktop. Do not submit live bookings or provider jobs merely for screenshots.
3. Fetch main again; evaluate any base movement and rerun checks against the exact merge candidate. Open a focused PR and wait for CI. No migration/env/provider rollout steps are needed.
4. Only the parent performs the separately authorized merge/deployment. Verify production route/theme behavior and fresh errors after deployment.
5. Rollback is a code-only revert of the skin commit; no data rollback or provider reconciliation required.
