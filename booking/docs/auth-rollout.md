# Auth provisioning and rollout

Company access is invitation-only. Public Supabase Auth signup must remain disabled; application UI and database triggers are additional defenses, not a replacement for the Auth setting.

## Fresh project bootstrap

1. Apply `supabase/setup.sql` to the empty project.
2. In Supabase Auth settings, disable **Allow new users to sign up** before exposing the project URL or anon key.
3. Configure the normal application/service-role and email-delivery environment variables.
4. Set these one-time values:

   ```sh
   export BOOTSTRAP_COMPANY_NAME='Example Photography'
   export BOOTSTRAP_COMPANY_SLUG='example-photography'
   export BOOTSTRAP_OWNER_NAME='Owner Name'
   export BOOTSTRAP_OWNER_EMAIL='owner@example.com'
   ```

   Optional colors are `BOOTSTRAP_PRIMARY_COLOR` and `BOOTSTRAP_ACCENT_COLOR`.

5. Run `npm run bootstrap:first-company` from `booking/`.
6. Verify that the owner setup email was delivered and the password can be set.

The standalone service-role command requires an otherwise empty account database,
uses a `company_invitation_id` marker to bypass generic-signup rejection, creates
the first admin profile and owner membership, then emails a link to the signed
password-reset request flow. If delivery is ambiguous after database commit, the
owner is preserved; open `/auth/reset` for that address instead of rerunning bootstrap.
It refuses to run if any profile or owner/admin membership already exists, so it
cannot be reused as a general provisioning bypass.

The database claim is serialized with an advisory transaction lock. If Auth user
creation returns an ambiguous response, the command prints a stable
`BOOTSTRAP_INVITATION_ID`; rerun with that value to recover the marker-bound Auth
identity instead of creating another one. Concurrent bootstrap attempts can create
at most one owner; losing attempts remove their own marker-bound Auth identity.

## Production rollout for migration 20260717140806

Do not use `supabase db push --include-all`. Local and linked migration histories may diverge.

1. Start a short maintenance window and control all public-booking and admin mutation traffic until the compatibility deployment and migration are fully healthy. Set production `ENABLE_PUBLIC_SIGNUP=0`, redeploy the current build, and verify `/start` plus `/start/oauth/complete` return 404. Do this before changing Supabase so the previous service-role company-creation action is closed too.
2. **Disable public Auth signup** in the linked Supabase project. Confirm password signup and new OAuth identities are rejected. Service-role admin creation remains available.
3. Deploy the compatibility build in which every legitimate `auth.admin.createUser` caller writes either `company_invitation_id` or both `realtor_organization_id` and a unique `realtor_provisioning_id`. Before the marker-lookup/quarantine RPCs exist, ambiguous creation or cleanup is preserved and returned with a correlation reference; do not retry that client operation until the migration is installed and the reference is reconciled.
4. Audit immediately before migration:
   - no unreviewed profile-less Auth identities;
   - no booking whose `organization_id` differs from its owner profile;
   - every unbooked realtor profile has been reviewed explicitly.
5. Wrap the exact contents of `supabase/migrations/20260717140806_quarantine_unprovisioned_auth_users.sql` in `begin; ... commit;` and apply that file to the linked project.
6. Mark **only** version `20260717140806` applied in the remote migration ledger with `supabase migration repair --linked --status applied 20260717140806`.
7. Run the auth provisioning canary and tenant-hardening canary. Confirm:
   - commands: `npm run verify:auth-provisioning` and `npx tsx scripts/verify-tenant-hardening.ts` from `booking/`, with the linked project's `NEXT_PUBLIC_SUPABASE_URL`, anon key, and service-role key loaded;
   - anonymous signup rolls back;
   - invitation creation stays profile-less;
   - trusted realtor creation lands in the exact tenant;
   - malformed/nonexistent tenant markers fail;
   - canary cleanup leaves no residue.
8. Verify company/realtor login, password reset, owner invitation claim, public booking, inbox acceptance, and calendar booking in production; then end maintenance.
9. Keep `ENABLE_PUBLIC_SIGNUP=0` and public Auth signup disabled permanently.

## Failure handling

- If deployment fails before migration, leave both signup controls disabled and roll back the app normally; the compatibility build is not required by the old trigger.
- If migration fails, its transaction must roll back completely. Resolve the reported audit mismatch; do not bypass the guard.
- If the migration succeeds but application verification fails, do not re-enable signup and do not roll back to code with unmarked `createUser` callers. Repair forward or redeploy the reviewed marker-writing build.
- If SQL commits but migration-ledger repair fails, do not rerun the SQL. Verify the functions/tables and repair only version `20260717140806` as applied.
- Failed or ambiguous realtor provisioning returns a correlation reference and writes a service-only `provisioning_cleanup_events` row when the database is reachable. Resolve the event before asking the client to retry. Cleanup never performs legacy destructive guesses: unavailable marker/quarantine verification preserves the identity for operator reconciliation.
- Reconcile a reference with service-role/operator access before retrying:
  `select * from public.provisioning_cleanup_events where id = '<reference>'::uuid or provisioning_id = '<reference>'::uuid;`
  If no row exists, search `auth.users.raw_app_meta_data ->> 'realtor_provisioning_id'` for the same UUID; the displayed reference is the marker itself even when event persistence failed. Verify bookings, properties, memberships, profile tenant/role, and Auth metadata before deleting or retaining anything.
