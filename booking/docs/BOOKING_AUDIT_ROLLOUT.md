# Booking audit rollout

This change is not a zero-downtime, old-writer-compatible pricing migration.
The database enforces a deliberate write pause and requires refreshed quotes.
Do not mark production compatibility approved solely because CI passes.
The independent approval and exact merged-SHA requirements in
[PRODUCTION_RELEASE_EVIDENCE.md](PRODUCTION_RELEASE_EVIDENCE.md) still apply.

## Order and compatibility

Review and apply only these pending migrations to the independently verified
booking database, in filename order. Never apply the fresh-project setup there.

1. `20260930185645_public_booking_property_identity.sql`: adds city/postal identity
   to new property matching. No historical relinking.
2. `20260930185759_booking_lifecycle_notices.sql`: installs the durable notice
   table, service-only RPCs, leases and receipts. No historical notice backfill.
3. `20260930202500_booking_quote_policy_guard.sql`: pauses new public and admin
   aggregate requests, while retaining previously committed request replays.
4. `20260930203055_booking_size_and_basement_policy.sql`: installs catalog fee
   fields and new snapshot calculations, then activates quote policy
   `2026-09-30-v1`. Existing snapshots/end times are not rewritten.

The old public entry point remains replay-only after activation. The updated
application submits the browser's quote version to the versioned entry point;
missing or stale versions fail before new booking writes. The new calculation
core also requires scoped compatibility context from that entry point, so an
already-running old wrapper cannot silently enter new calculations. Context is
restored on success and exception; it does not replace tenant authorization.
Admin creations and package replacements likewise require the reviewed version.
Edits retaining the same historical items retain their booked price/duration.
Committed admin create/edit retries compare business inputs independently of
quote-version metadata, including during the pause. Stored historical request
fingerprints remain unchanged; actor, tenant and changed-input checks still run.
Admin create retries cannot provision another account.

Until compatible application code is deployed, old instances can still show old
quotes but cannot create a new booking at the changed terms. Coordinate this
booking interruption with the owner. A refreshed confirmation is required after
cutover. Do not force-upgrade a posted old quote version on the server.

## Verification and rollout gate

Before any production change, verify canonical Vercel project
`pixel-blaster-media` (`prj_QmEJtyuVnVhXILDCJiTPbZr2EdT5`), root `booking`, and
that Git auto-deployment is disabled for every branch. Resolve denied access
through the existing account/team connection; do not use another access path.
Inspect live schema, signatures, grants, policies and ledger again, reconcile any
drift, and obtain accountable review of the exact migration bytes and this pause.
The production release guard also requires a fresh reviewer attestation bound
to the final merged SHA and successful main-push CI for that exact SHA.

The isolated PostgreSQL gate tests pre-policy old-code writes, the paused phase,
old/missing/stale versions, an old wrapper in flight, current quotes, historical
replay and side-effect counts. It separately executes the entire generated fresh
setup, grant/tenant checks, quote boundaries and lifecycle behavior. The built
browser gate tests real Server Action/RSC POST, private owner-checked rebooking,
repeated rebooking cookie bounds, stale/expired anonymous confirmation rejection,
session-cookie receipt rerender, receipt reload and expired-cookie POST replay against a
synthetic Supabase transport. These do not prove live provider delivery.

Deploy only through the repository's guarded release process. Read back Ready
status, exact SHA, canonical aliases and cron configuration afterward. Use safe
health/auth/navigation checks; do not create a real appointment or send messages
as a smoke test. Provider sandbox/end-to-end acceptance remains separate.

## Recovery

Record the prior Ready deployment and database recovery point before rollout.
If application deployment fails after schema activation, keep the quote guard in
place: old-code new bookings remain safely blocked. Restore a known compatible
application build or fix forward. Rolling the application back to pre-policy
code is not a full service rollback; it deliberately keeps new booking writes
blocked. Do not undo catalog/snapshot history, reset historical end times or
resend old notices. Any database reversal requires its own reviewed recovery
plan; no destructive down migration is supplied.
