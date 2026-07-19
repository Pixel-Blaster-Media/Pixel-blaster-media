# Booking integration outbox

Migration `20260718202432_atomic_public_booking_outbox.sql` establishes the first durable booking-integration boundary.

## Guarantees in this release

- Property creation/reuse, booking creation, immutable catalog snapshots, complete versioned provider payloads, and initial integration jobs commit in one PostgreSQL transaction.
- Job tenant/booking/type/idempotency identity and provider payload are immutable after enqueue; every inline consumer executes booking facts from the claimed payload rather than request-local or mutable profile/catalog data. A customer-email claim additionally carries the completed QuickBooks job's durable `invoice_url` result from the same database claim snapshot so the established payment-link behavior is preserved.
- The customer-confirmation job cannot be claimed while its booking's QuickBooks invoice job is pending, retryable, or processing. It proceeds only when that job is absent or terminal, preventing concurrent request replays from permanently omitting a payment link.
- Payload line items preserve submitted service order followed by submitted add-on order.
- A client request UUID is tenant-scoped and fingerprinted. An identical committed request can be replayed by the still-active realtor even if the slot is now occupied or selected catalog items were later deactivated; archived access remains forbidden.
- Provider calls happen only after the transaction commits.
- Every provider attempt must atomically claim a job and receives a fenced lease token.
- Completion requires the same tenant, job, unexpired lease, and lease token.
- Attempt exhaustion is enforced in PostgreSQL and ends in `dead_letter`.
- Resend receives the job idempotency key. Expired processing leases and `retryable` customer/admin emails are claimable only while the job is under 23 hours old; once that cutoff is reached they are dead-lettered on the next claim instead of being sent again.
- QuickBooks, Google Calendar, and push attempts are never automatically replayed after an expired/ambiguous lease. They are dead-lettered for reconciliation instead of risking duplicate external effects.

These are at-least-once local queue semantics with provider-specific safety rules. They are not exactly-once provider semantics.

## Dispatch paths

Public booking and scheduled recovery use the same provider dispatcher. After the booking aggregate commits, the dispatcher always runs these phases in order:

1. QuickBooks invoice.
2. Google Calendar event.
3. Customer email, admin email, and admin push in parallel.

Every provider receives facts from the claimed immutable payload. Mutable profile, catalog, and request-local facts are not reloaded to construct provider mutations. Claim outcomes distinguish work that is not currently claimable from database/compatibility failures, and completion-persistence failures remain distinct from provider outcomes. Stored worker IDs are explicit UUID-derived values bounded to 96 characters.

Provider mutations have a 15-second application timeout and settlement calls have a 2-second timeout. A provider timeout does not cancel the underlying request, so the job keeps its processing lease instead of being settled prematurely. After lease expiry, non-email work becomes ambiguous and requires reconciliation; email may be reclaimed only inside the established Resend idempotency window.

## Scheduled recovery

Migration `20260719124500_integration_outbox_recovery_reconciliation.sql` is additive and is **not applied or enabled by this branch**. It adds:

- `list_due_integration_jobs(limit, dispatch_not_before)`, a service-role-only identities list that excludes jobs created before the reviewed rollout watermark;
- tenant-fair booking ordering, with QuickBooks invoice ahead of customer email;
- expired-processing discovery, atomic claim-time cancelled-booking terminalization, preservation of active leases, and a database prohibition on non-email `retryable` state;
- reconciliation audit columns and a single-use authenticated tenant-admin reconciliation RPC.

The scheduler requests at most 5 due identities, groups only those listed job types by booking, runs at most 2 booking dispatchers concurrently, and stops starting work at a 45-second deadline. The cron route reads the canonical ISO rollout watermark only from `INTEGRATION_OUTBOX_DISPATCH_NOT_BEFORE`; callers cannot supply or widen it. The scheduler and route emit aggregate counts only—never tenant IDs, booking IDs, payloads, provider responses, recipient data, or credentials.

The route fails closed unless all conditions are true:

- `CRON_SECRET` exists and the request supplies `Authorization: Bearer <configured-value>`.
- `INTEGRATION_OUTBOX_DISPATCH_ENABLED` is exactly `true`.
- `INTEGRATION_OUTBOX_DISPATCH_NOT_BEFORE` is a canonical UTC ISO timestamp selected during the reviewed rollout.

The example and default are `false`. This work does not enable production dispatch.

### Recovery rollout order

Use this fail-closed order. Never deploy code that queries the new columns or RPCs before the database is compatible.

1. Inspect the live queue and assess row count and migration lock risk.
2. Apply and verify migration `20260719124500` while the existing application remains deployed. Apply only this exact reviewed version; never use `--include-all` or broad ledger repair.
3. Choose and configure `INTEGRATION_OUTBOX_DISPATCH_NOT_BEFORE` as a canonical UTC timestamp. Jobs created before that cutoff remain excluded from scheduled recovery.
4. Keep `INTEGRATION_OUTBOX_DISPATCH_ENABLED=false` and deploy the compatible application.
5. Verify the admin exception page, disabled cron response, queue aggregates, and exact deployed commit.
6. Enable scheduled dispatch only after operator approval, then supervise the first bounded run and inspect aggregate/job state before leaving it enabled.

`vercel.json` schedules the existing reminder at 21:00 UTC and outbox recovery at 21:05 UTC, each once daily. As of the current Vercel documentation, Hobby permits up to 100 cron jobs per project with a minimum interval of once per day; the added schedule uses one additional function invocation per day and stays inside that floor and count. Hobby timing may drift within the scheduled hour, so this daily job is recovery rather than low-latency delivery. More frequent recovery requires Pro and an explicit cost/operations decision. See [Vercel Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Operator reconciliation

`/admin/integrations/jobs` is an exception-only secondary page linked from Connections; it is not a primary navigation tab. It selects only tenant-scoped operational columns and never loads provider payloads/results, idempotency keys, lease tokens, worker IDs, or provider error bodies.

- **Process email now** appears only for a due pending email or a retryable email still inside the 23-hour provider window.
- Dead letters are never blindly retried. An admin must inspect the provider and booking, then choose a reconciliation category and enter a 10–2000 character note.
- Reconciliation is single-use and records timestamp, authenticated admin, category, and note.
- Manual QuickBooks invoice creation fails closed while the booking has an unresolved ambiguous QuickBooks outbox job.

## PostgreSQL verification

Run `npm run test:postgres:atomic` to initialize a disposable PostgreSQL 17 cluster, install the fixture and exact migration, execute transactional/replay/tenant/lease regressions, and tear the cluster down. The suite fails if PostgreSQL 17 binaries are unavailable; set `POSTGRES_BIN` when they are not on `PATH`.

## Rollout status — completed

Production already contains migration `20260718202432`, its ledger entry is applied, and the compatible application is deployed. **Do not reapply migration `20260718202432` or repair its production ledger entry.** The sequence below records what was completed; it is not an active production runbook:

1. Local and linked migration history were inspected without `--include-all`.
2. The exact reviewed migration was applied transactionally.
3. Only version `20260718202432` was recorded as applied after schema verification.
4. Columns, snapshot compatibility, constraints/indexes, RLS/grants, and the service-role RPCs were verified.
5. The compatible application was deployed after database verification.

The `(organization_id, id)` unique index on `bookings` now supports the tenant-qualified outbox foreign key. It has already been created; do not rebuild it as part of routine operations.

## Reconciliation rules

- `retryable`: safe provider retry is allowed, currently email only.
- `dead_letter` with `ambiguous_provider_result` or `lease_expired_ambiguous`: inspect the provider and local booking before any manual replay.
- `partial_push_failure`: do not replay the aggregate push without provider/subscription-level review.
- A completion-persistence error leaves the lease/job durable. Within 23 hours email is idempotently reclaimed; older email and ambiguous-provider attempts are terminalized.
- Reconciliation categories are `provider_confirmed_completed`, `provider_confirmed_absent`, `duplicate_resolved`, and `accepted_manual_resolution`.
- Marking a job reconciled records an audit acknowledgement; it does not change the provider result or replay the mutation.
