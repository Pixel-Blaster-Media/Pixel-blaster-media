# Precision application skin — corrected review handoff

Status: **local candidate, independent parent review pending**. No push, PR, merge, deployment, live credentials, booking mutation or provider operation performed.

## Presentation and tenant boundary

- `app/precision-skin.css` is imported after unchanged `globals.css`; `/book`, `/portal`, `/admin` opt in with `.pixel-app-skin`. Root body styling additionally requires an opted-in descendant. Marketing, auth, app landing and public listing routes remain outside the skin.
- Silver/white surfaces, compact outer panels and softer controls remain the approved presentation. Existing route structure, sticky total, calendar layout and interaction model are retained.
- **Only default-organization theme owners receive important blue primary/hover/dark tokens and matching RGB values.** `data-pixel-default-palette` is derived from the existing `DEFAULT_ORGANIZATION_ID`: root uses current-user identity (anonymous root may opt in), admin/portal use their required user's organization, and `BookingBrandFrame` uses its resolved booking organization. Names, green color matches and brand-load results never classify a tenant.
- A known custom tenant remains unmarked even if loading its branding returns an error/null. An unidentified booking frame is not marked. No fallback identity, lookup, authorization or data-loading changes were introduced.
- Custom inline primary/hover/dark/RGB, border and accent remain authoritative, on same-element shells and nested real booking frames. Generic border is a nonimportant neutral fallback. Selected backgrounds/shadows and focus shadows use the active `--realtor-primary-rgb`.
- Two explicit presentation-only caption markers repair newly worsened contrast: the job's confirmed status (only its existing `text-brand-light` tone) and the selected listing-template caption. They use the active dark primary; the status override matches the pre-existing important admin text alias. Other statuses, captions, semantic colors and baseline accessibility findings are not broadly hardened.

## No-behavior-drift proof

`tests/precision-boundary.test.mjs` compares every changed production TSX file against base `3039dbc357f78b3c9a97d5dbe1d5c0c54785f85f`, removing only exact allowlisted additions: skin/panel/caption classes, CSS import, `DEFAULT_ORGANIZATION_ID` imports and the four exact marker attributes. All ten TSX files compare byte-identically afterward. The test also fixes the complete changed-TSX file inventory and rejects branding/name/color-based identity classification.

No pricing/catalog, booking state/actions/validation, auth, payment, calendar handlers, providers, persistence, schemas, middleware, dependencies or configuration changed. Browser fixture before/after comparisons have identical visible-control counts and rendered text (excluding the fixture's BEFORE/AFTER label).

## Verification

- Booking unit suite: **593 passed, 0 failed**; root marketing/proxy suite: **5 passed, 0 failed**.
- `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`: passed. Existing middleware-deprecation, credential-free admin-prerender and Node module-type warnings remain; no unrelated repair attempted.
- `tests/precision-palette.browser.mjs`: **31 computed Chromium cases**. Covers default/custom/unknown same-element and nested real frames, non-app contexts, actual async root/admin/portal/book layouts, branding failures and a booking organization differing from the signed-in user's organization. Checks complete primary family, RGB, accent and border preservation plus tenant-colored selected/focus treatments.
- Initial computed RED preceded production edits. Expanded test replay against immutable original candidate `0e5eaf7358995546a746c614688f8f0a429c3984` fails for the reported cascade/identity defects; corrected source passes.
- Full real component gap fixture rerun: **42 cases**, seven states × before/after × 320/390/1440; **84 original screenshots** and **36 extra palette/bottom-hit probes**. States: Media, Website, Delivery, Details with expanded invoice, anonymous confirmation, signed-in confirmation and success. Zero overflow/out-of-bounds descendants, console/page errors, intercepted external requests, denied actions/fetches, changed control counts or obstructed sampled bottom controls.
- Complete default confirmation CTA now computes `rgb(7, 102, 216)` with white text; before skin it is `rgb(63, 115, 86)`. Success and operator actions consistently use blue. Custom palettes remain custom in the separate computed matrix.
- Computed contrast RED reproduced confirmed **4.06** and selected caption **3.82**; GREEN is **5.81** and **5.45**, respectively. Original baseline was 4.40 and 4.14. Unrelated existing low-contrast combinations are not claimed fixed; this is not an exhaustive WCAG audit.

## Evidence and commands

Audit root: `/Users/PlatoTheBot/.hermes/audits/pixel-precision-app-skin/`.

- `logs/palette-red.log`: original test RED before production edits.
- `logs/palette-expanded-red.log`, `logs/palette-green.log`: immutable original-candidate RED / corrected GREEN.
- `logs/correction-{tests,root-tests,lint,types,build}.log`.
- `correction/`: copied existing gap harness, rebuilt real components, `manifest.json`, `results.json`, `probes.json`, `verified-summary.json`, `contrast-{red,green}.log`, `screenshots/`, `boards/`.
- Original `gap/` evidence remains unchanged. The corrected fixture uses the actual default ID on its fictional organization, and an anonymous-root palette marker; it does not identify fictional data by company name.

From `booking/`:

```sh
npm test
npm run lint
npm run typecheck
npm run build
node --test tests/precision*.test.mjs
PIXEL_BROWSER_TOOLS=/Users/PlatoTheBot/.hermes/designs/pixel-precision-preview/node_modules node tests/precision-palette.browser.mjs
```

For RED replay, additionally set `PIXEL_PALETTE_SOURCE` to `correction/red-source/booking` (a `git archive` of the original candidate). Browser tooling lives outside production dependencies.

From `correction/`: `node build.mjs`; start `node server.mjs` on loopback 4381; run `node contrast.mjs && node qa.mjs && node probes.mjs && python3 boards.py`; stop the fixture server afterward. All real component data/auth/provider/action/navigation boundaries are replaced with read-only fictional fixtures; requests/methods/CSP are restricted. No authenticated live E2E, actual submit, provider integration, physical iOS or persisted navigation claim is made.

Useful screenshots: `boards/confirm-after-phone.png`, `boards/confirm-signed-after-phone.png`, `boards/confirm-desktop.png`, `boards/website-after-phone.png`, `boards/details-after-phone.png`, `boards/success-desktop.png`. Bottom viewport PNGs distinguish the full-page fixed-nav capture artifact from actual page-end obstruction.

Earlier unaffected calendar/property/portal fixture evidence remains in the audit root (original 48 component and 16 SSR cases plus interaction/drag/short-phone probes). The new gap evidence uses complete real job tab bodies and full confirmation/success pages, not the earlier placeholder bodies. It still substitutes data/auth/provider boundaries and omits the root authenticated header in the full gap fixture; the separate palette test renders the real root with child adapters.

## Parent release gate

Independently review this exact finite commit, recheck current main/CI, and perform required authenticated read-only release verification. Only the parent may push/merge/deploy. No schema, environment or provider rollout is required. Rollback is a code-only revert of this correction together with the initial skin commit if reverting the whole presentation.
