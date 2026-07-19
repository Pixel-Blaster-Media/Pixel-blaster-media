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

## Initial dispatch path

The public booking request remains the initial dispatcher: after the aggregate commits, it claims and settles each job inline. Replaying the same request safely resumes pending or retryable jobs and resolves expired leases according to the rules above.

A general scheduled dispatcher and operator outbox UI are intentionally deferred. Until those ship, a pending/retryable job that is not reached by request replay remains durable but requires an operator-triggered replay. This limitation must not be described as automatic retry.

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
