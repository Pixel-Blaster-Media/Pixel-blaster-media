# LIFE-02 calendar edit CAS fix

- Base: `e047156b97d5bc1305399b2d41ac866cda3d0954`
- Implementation commit: `5ae9d38dd87624112c25a1ab0fbef662c595e402`
- Scoped staged diff SHA-256: `cc07affb4c2bddd2ef67865172faa5d92e1762e66486a54f8f6288aff3ea4b20`
- Branch: `fix/audit-final-calendar-cas`
- Local only. No production/provider calls, pushes, migrations, setup regeneration, or integration-tree edits.

## Reproduction / RED

Ran the supplied immutable `final-lifecycle-cas-probe.mjs` against the audit candidate. It confirmed the actual quick editor omitted both tokens, the action forwarded current database version 99 for an obsolete catalog selection, and two identical calls received distinct generated request IDs. That probe deliberately exits zero when it confirms the defect; it is not a passing correctness test.

Added `booking/tests/calendar-edit-cas.behavior.test.mjs`: transpiles and renders the real CalendarQuickView and EditBookingForm with React test renderer, invokes rendered checkbox/save/form handlers, and runs the actual extracted server actions. Framework/provider boundaries and database adapter are mocked; UI FormData construction is not reimplemented. The independent PostgreSQL suite verifies the actual SQL boundary.

Observed genuine RED results before corresponding fixes:
- Real quick editor repeated save: `identical replay must not sync again`, actual 2 versus expected 1.
- Both detail/package actions accepted absent request identity: actual `ok=true`, expected false.
- Full editor retained old draft values but submitted refreshed prop version: actual 8 versus expected 7.
- After freezing draft version, the next acknowledged full-editor edit initially retained the old version and failed; fixed by returning the aggregate's committed version and advancing only from that acknowledgement.

Initial harness attempts targeted catalog controls as buttons; corrected them to the actual checkbox handlers before accepting RED evidence.

## Changes

- Calendar page selects lifecycle_version and projects it through bookingDetails to the quick editor.
- Quick editor captures the draft version and retains a client request UUID across retry/replay. Existing styling is unchanged.
- Both mutation actions reject absent, malformed, duplicate, non-string, non-positive, noncanonical, or unsafe-number concurrency tokens before RPC. No latest-version or random-key fallback remains.
- Full editor does not adopt unrelated prop refresh versions while retaining its draft. Its own acknowledged aggregate result advances its CAS base for subsequent edits.
- Added actual-caller stale editor/replay behavior tests, token rejection matrix, full-editor refresh/second-edit tests, and a structural page projection guard.
- Extended real PostgreSQL tests for missing tokens, identical edit replay, stale package replacement preserving winning line snapshots/duration, and request-count preservation. No SQL implementation or invoice code changed.

## GREEN verification

Commands run from `booking/`, all exit 0:

```sh
node --test tests/calendar-edit-cas.behavior.test.mjs tests/admin-action-runtime.test.mjs tests/admin-lifecycle-wiring.test.mjs tests/calendar-quick-view-regression.test.mjs tests/admin-booking-historical-catalog.test.mjs
LC_ALL=C python3 scripts/verify-admin-lifecycle-postgres.py
npx tsc --noEmit --incremental false
npx eslint app/admin/calendar/CalendarWeekView.tsx app/admin/calendar/page.tsx 'app/admin/bookings/[id]/actions.ts' 'app/admin/bookings/[id]/EditBookingForm.tsx' tests/calendar-edit-cas.behavior.test.mjs
git diff --check
```

- Focused Node tests: **26 passed, 0 failed**.
- PostgreSQL: stale package replacement preserves winning snapshots and identical replay; observed two-session CAS lock conflict and rollback release; aggregate recovery returned-version and forced-refresh rollback checks all passed.
- Typecheck and focused lint produced no diagnostics.
- Disposable PostgreSQL runner completed its finally cleanup. No browser/server fixtures were created. Only an ignored booking/node_modules symlink to integration dependencies was used.

## Limitations / next gate

Full application test/build and independent exact-candidate review belong to the parent integration gate. No browser geometry or production behavior attestation is claimed. Page read/projection is source-guarded; editor/action behavior uses React rendering and the real action bodies, with separately executed real PostgreSQL behavior/concurrency tests.

Reusable lesson: freeze concurrency versions with retained form drafts, not refreshed props, and exercise the actual UI submitter in action regressions; manually adding tokens to test FormData can conceal a completely missing caller contract.
