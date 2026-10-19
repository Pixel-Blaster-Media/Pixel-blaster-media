# Customer booking notice

The availability screen now has **Require at least 24 hours’ notice for customer
bookings** under **Admin → Settings → Availability → Booking notice**. Saving the
checkbox changes only the signed-in admin's organization.

The setting defaults to **off**, including existing organizations. This change
does not activate the policy, alter existing appointments, or send anything.

## Behavior and scope

- When enabled, customers must select a start time at least 24 elapsed hours from
  the current server time. Exactly 24 hours is allowed; one millisecond earlier
  is rejected in application checks (one microsecond in PostgreSQL).
- The interval is 86,400 seconds, independent of the browser/server timezone and
  Toronto daylight-saving transitions. Customer times continue to display in
  Eastern Time. It is not a “tomorrow” or calendar-date restriction.
- Public booking and signed-in realtor entry points share the same availability
  engine. It filters too-soon slots and rechecks the cutoff after calendar reads.
- Submission checks fresh settings before inbox verification, account creation,
  or notification work. Stale selections and database cutoff rejections show a
  clear 24-hour explanation and direct the customer to the studio for exceptions.
- The database checks at admission using `clock_timestamp()` after the existing
  tenant calendar lock and a settings-row lock. Rejected creation rolls back the
  property, booking, line snapshots and integration jobs together. No new jobs
  dispatch after a failed write.
- Customer self-service rescheduling uses the same rule, preventing an advance
  booking followed by a move into the blocked window. Existing appointments
  remain in place, and cancellation behavior is unchanged.
- A previously committed request can still replay its receipt after the policy
  changes or the appointment enters the notice window. It creates no duplicate.
- Settings failures/missing schema fail closed instead of silently turning off
  the rule. Never deploy this application before the migration is present.

## Admin behavior and access

Existing authenticated admin creation/editing and request acceptance remain
available inside 24 hours. This preserves the studio's current manual scheduling
workflow; there is no new override switch, customer flag, role or permission.
Public creation is restricted even if someone posts `allow_schedule_overlap`.
The existing direct authenticated owner-insert path is also protected when it
omits `public_request_id`; the trigger checks the authenticated database role and
organization admin membership, not caller-supplied booking fields.

The trigger is a narrowly scoped `SECURITY DEFINER` function because customer
roles cannot read organization settings through RLS. It only validates admission,
uses an empty search path, grants no table access, and cannot be invoked as a
customer RPC. Other helper functions are service-only, security invoker functions.
The original tenant policies, admin checks and lifecycle permission checks remain.

## Root cause

At the reviewed `main` baseline (`148c38ab01ad3151062eebfc31385d40067b2795`, including
marketing PR103), there was no lead-time setting. The customer slot loader began
at the next whole hour, and server checks enforced business hours and conflicts
without a minimum notice interval. This permits same-day bookings by design.
No production booking record was inspected or modified to establish which exact
path created the reported appointment. The finding is from the code path.

## Activation after review

1. Review this local candidate before publishing. No branch has been pushed or PR
   created during this task. Any eventual PR should remain draft until approved.
2. Follow `DEPLOYMENT.md` and `docs/PRODUCTION_RELEASE_EVIDENCE.md`. Verify the live
   schema and migration ledger with read-only checks. The linked dry run must
   name only `20261019130903_customer_booking_notice.sql`; do not use
   `--include-all`, bootstrap files, or `supabase/setup.sql` on an existing DB.
3. After separate rollout authorization, apply that additive migration. Its false
   default preserves existing behavior. No historical appointments are rewritten.
4. Deploy the reviewed application to the canonical booking project
   `pixel-blaster-media` (`booking/` root). Do not deploy the marketing project.
   Verify settings rendering and read-only availability, without test bookings,
   emails, invitations, payments, or cancellations in production.
5. After explicit activation approval, check and save the option in the Pixel
   Blaster organization's Availability settings. Reload to confirm persistence.
   New availability and submission requests then enforce it immediately.

Turning the checkbox off restores existing customer scheduling behavior without
changing appointments. If the application must be rolled back, disable the policy
first; the additive schema can remain. An older app does not understand the new
error code or explain unavailable times, although the database still guards new
customer writes while enabled.

## Verification

- `npm test` in `booking/`: application tests, including actual availability,
  settings/actions, customer messaging, stale selections, checkbox interaction,
  and unchanged design boundaries.
- `npm run typecheck`, `npm run lint`, and a production build with fake localhost
  service configuration.
- `node --test tests/postgres/clean-bootstrap.test.mjs`: full disposable
  PostgreSQL 17 bootstrap and negative migration/grant tests. The fixture
  `tests/postgres/customer-booking-notice.behavior.sql` exercises enable/disable,
  tenant isolation, direct authenticated insert protection, atomic rollback,
  committed replay, admin create/edit, customer rescheduling and cancellation,
  timezone/DST boundaries and elapsed time within a transaction.
- Root `npm test`: existing marketing/proxy regressions; root marketing files
  are unchanged.
- `node tests/customer-booking-notice.preview.mjs`: loopback-only visual fixture
  rendering the actual checkbox component with temporary synthetic persistence.
  Chrome review verified enabled and disabled saves and reloads. The fixture has
  no live SDK or production environment configuration.

Supabase trigger guidance was checked against the current
[official documentation](https://supabase.com/docs/guides/database/postgres/triggers).
