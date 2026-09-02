# Private booking notes rollout

Issue #69 is complete only after both database phases, the compatible application deployment, and authenticated production verification have passed.

## Invariants

- Never run `supabase db push --include-all`.
- Never expose or log note text during preflight, migration, or verification.
- Apply only the exact reviewed migration version named for the active phase.
- The expand migration must commit before the application is merged/deployed.
- The contract migration must not run until the exact compatible deployment is Ready, promoted, and old instances have drained.
- After contract, rollback is limited to the compatible application. Rehydrating the legacy column reopens the confidentiality defect and requires explicit approval.

## 1. Preflight

1. Capture the current linked migration ledger and compare it with `supabase/production-migration-ledger.json`.
2. Confirm PITR/backup availability.
3. Read only aggregate facts:
   - count of `bookings.internal_notes IS NOT NULL`;
   - count of empty strings;
   - maximum `char_length(internal_notes)`;
   - count over 2,000 characters.
4. Stop if any note exceeds 2,000 characters or if the linked ledger would replay any unrelated migration.

## 2. Expand

Apply only:

`20260831144638_private_booking_internal_notes_expand.sql`

The apply wrapper must use one transaction and preserve the migration's lock and statement timeouts. Verify without reading note text:

- `booking_internal_notes` exists with the tenant-qualified booking foreign key;
- browser roles and `service_role` have no direct table DML;
- only `service_role` can execute the bounded read and revisioned mutation RPCs;
- the legacy bridge exists;
- legacy non-null count equals private non-null count;
- no legacy/private value mismatch exists;
- the migration ledger records only the exact expand version.

## 3. Deploy and drain

1. Merge only the exact reviewed commit.
2. Bind the Vercel deployment to that full commit, project `pixel-blaster-media`, project ID `prj_QmEJtyuVnVhXILDCJiTPbZr2EdT5`, and root `booking`.
3. Require Ready and Promoted state plus the exact `pixel-blaster-media.vercel.app` alias mapping.
4. Verify Today, Details, Calendar, Today AI context, focused saves, assistant updates, and assistant undo use the service-only boundary.
5. Wait for old application instances to drain.
6. Recheck aggregate equality between legacy and private notes. Any mismatch blocks contract.

## 4. Contract

Apply only:

`20260831144639_private_booking_internal_notes_contract.sql`

The migration itself locks both tables and aborts before cleanup unless every legacy/private value is exactly synchronized. Verify:

- the legacy bridge is gone;
- the post-contract mutation RPC no longer dual-writes;
- every `bookings.internal_notes` value is `NULL`;
- `bookings_internal_notes_must_be_null` is validated;
- private values and revisions remain unchanged;
- the migration ledger records only the exact contract version.

## 5. Production verification

- Re-attest the app deployment, stable alias, canonical website proxy project/deployment, and public health route.
- Exercise the authenticated private-note editor through `https://pixelblastermedia.com` with a bounded synthetic administrator and an exact synthetic booking fixture or another explicitly approved non-business fixture.
- Prove add, edit, clear, conflict, and 2,000-character behavior without mutating a real customer booking.
- Run the independent reaper and prove zero Auth/profile/membership/booking/private-note residue.
- Check bounded exact-deployment logs for the exact canary routes and zero 5xx responses.

Only then close issue #69.
