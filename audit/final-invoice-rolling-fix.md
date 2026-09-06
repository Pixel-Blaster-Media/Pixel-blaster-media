# LIFE-07 / PROVIDER-ROLLING-01: local rolling authorization repair

## Identity and scope

- Workspace: `/Users/PlatoTheBot/.hermes/workspaces/pixel-audit-final-invoice-0906`
- Branch: `fix/audit-final-invoice-rolling`
- Starting candidate: `e047156b97d5bc1305399b2d41ac866cda3d0954`
- Exact legacy writer inspected: `e625365f2958cb156b5475262bf9d0874c7ae0ac:booking/lib/integrations/quickbooks/invoice.ts`.
- Implementation and regression commit: `82c57fdd309ee9a8fdb0e9e498f5cfec27fc4a9a`.
- Independent finding: `/Users/PlatoTheBot/.hermes/audits/pixel-booking-2026-09-05/final-provider-quality-review.json`, `PROVIDER-ROLLING-01`.
- Local-only verification: PostgreSQL 17.10 (Homebrew), Node v24.14.0. No production database, provider network mutation, push, deploy, gateway/config change, overlap waiver, or edit to the integration workspace.

## Actual RED before production edits

From `booking/`:

```sh
bash lib/integrations/quickbooks/tests/verify-postgres.sh
```

Exit **1** with the original candidate migration and the new regression. The disposable PostgreSQL runner executed actual service-role SQL: new begin, stage, committed `finish_quickbooks_invoice(...,'unknown')`, then the exact legacy acquisition predicate including booking ID, organization ID, invoice ID null, status null or not creating, and `RETURNING id`.

```text
AssertionError: ('new unknown authorized legacy provider mutation', '11111111-1111-4111-8111-111111111111')
```

The booking had `reconciliation_required`; the durable intent was `unknown`. The old claim nevertheless returned an ID. This proves duplicate mutation **authorization**, not a live duplicate invoice. Original old-to-new and successful-receipt tests passed before the new regression failed.

Full RED: `/Users/PlatoTheBot/.hermes/audits/pixel-booking-2026-09-05/final-invoice-rolling-red.log`.

## Root cause and minimal permanent fix

The legacy capture trigger's conflict UPDATE only changed `pending` intents but silently accepted all other conflicts. A non-creating booking projection therefore let the legacy writer acquire despite a durable unknown receipt.

The existing invoice-intents migration now raises `invoice mutation requires reconciliation` when the permanent capture cannot insert or transition a pending intent. The entire old claim statement rolls back; no returned ID can authorize a provider call. This rejects unknown, rejected, confirmed, active-processing and expired-processing conflicts; it does not depend on application rollout timing.

New begin keeps its existing booking-first row lock, eligibility checks, and snapshot validation. It now acquires through the same permanent booking trigger **before** promoting that statement's capture to processing and issuing a lease, atomically. Promotion requires the captured unknown/legacy_creating state; missing capture raises. There is no caller-controlled bypass and no blanket processing-intent exception. Pending intent identity is preserved. Old successful receipt writes do not acquire creating and remain compatible.

Only the invoice migration and `booking/lib/integrations/quickbooks/tests/rolling.behavior.py` changed in the implementation commit. No invoice TypeScript change was needed; other prior lanes are unchanged. No destructive production SQL was introduced; existing fixture resets and forced expiry run only inside the runner's isolated disposable database.

## GREEN and compatibility evidence

The unchanged focused runner then exited **0**, and the expanded final suite also exited **0**:

- Existing old-to-new ambiguous-clear protection, absent and preexisting pending intents.
- Existing old successful receipt remains confirmed to new code.
- Existing two-session old/new handoff rejects fresh leases.
- Authorized new begin retains a processing lease; existing SQL suite verifies staging and atomic successful receipt/link.
- New unknown and rejected outcomes reject the exact old claim through the guard.
- New confirmed receipt yields no old claim authorization; a stale booking projection clear still cannot defeat the confirmed durable intent.
- Active and expired processing remain blocked by the old creating predicate; after a legacy clear both are rejected by the durable guard.
- Expiry reconciled through new begin becomes unknown/lease_expired, rejects stale completion, and blocks the old claim.
- Old-to-old ambiguous retries are permanently blocked, both with and without preexisting pending intent.
- Each denied attempt checks complete booking and intent row JSON equality before/after; expected trigger rejection is distinguished from unrelated SQL errors and from ordinary zero-row predicate rejection.
- Existing `intent.behavior.sql` and `adoption.behavior.sql` passed, including receipt/adoption behavior and rollback checks.

Full final PostgreSQL GREEN: `/Users/PlatoTheBot/.hermes/audits/pixel-booking-2026-09-05/final-invoice-rolling-green.log`.

```sh
npm run test:invoice
```

Exit **0**, **16 tests passed; 0 failed/skipped/cancelled**. Existing integration dependencies were used through a local ignored symlink after `cmp` verified equal package-lock bytes; integration files were not modified. Full Node GREEN: `/Users/PlatoTheBot/.hermes/audits/pixel-booking-2026-09-05/final-invoice-rolling-node-green.log`.

`git diff --check` and staged whitespace checks passed before the implementation commit. The disposable PostgreSQL runner's EXIT trap stops its own cluster and removes its own data/socket directories.

## Remaining parent gates

This is a committed local repair, not production closure. Parent owns shared generated setup/export regeneration, integration-wide checks/build, fresh exact-candidate review, and any separately authorized release. This document is a follow-up evidence-only commit so it can cite the immutable implementation SHA without self-reference.
