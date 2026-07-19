import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const {
  buildLoginContinuationPath,
  resolveAccountDestination,
  safePostAuthPath,
} = await import("../lib/auth/account-destination.ts");
const { shouldHandoffAuthCode } = await import(
  "../lib/auth/auth-code-handoff.ts"
);

const signInPage = readFileSync(
  new URL("../app/auth/sign-in/page.tsx", import.meta.url),
  "utf8",
);
const passwordAction = readFileSync(
  new URL("../app/auth/password/actions.ts", import.meta.url),
  "utf8",
);
const passwordPage = readFileSync(
  new URL("../app/auth/password/page.tsx", import.meta.url),
  "utf8",
);
const magicAction = readFileSync(
  new URL("../app/auth/sign-in/actions.ts", import.meta.url),
  "utf8",
);
const magicPage = readFileSync(
  new URL("../app/auth/magic/page.tsx", import.meta.url),
  "utf8",
);
const authCallback = readFileSync(
  new URL("../app/auth/callback/route.ts", import.meta.url),
  "utf8",
);
const oauthAction = readFileSync(
  new URL("../app/auth/oauth/actions.ts", import.meta.url),
  "utf8",
);
const rootLayout = readFileSync(
  new URL("../app/layout.tsx", import.meta.url),
  "utf8",
);
const requireAdmin = readFileSync(
  new URL("../lib/auth/require-admin.ts", import.meta.url),
  "utf8",
);
const requireUser = readFileSync(
  new URL("../lib/auth/require-user.ts", import.meta.url),
  "utf8",
);
const bookingAction = readFileSync(
  new URL("../app/book/actions.ts", import.meta.url),
  "utf8",
);
const inboxAction = readFileSync(
  new URL("../app/admin/inbox/[id]/actions.ts", import.meta.url),
  "utf8",
);
const calendarAction = readFileSync(
  new URL("../app/admin/calendar/actions.ts", import.meta.url),
  "utf8",
);
const resetConfirmAction = readFileSync(
  new URL("../app/auth/reset/confirm/actions.ts", import.meta.url),
  "utf8",
);
const resetRequestAction = readFileSync(
  new URL("../app/auth/reset/actions.ts", import.meta.url),
  "utf8",
);
const recoveryCallback = readFileSync(
  new URL("../app/auth/recovery/callback/route.ts", import.meta.url),
  "utf8",
);
const recoveryFlow = readFileSync(
  new URL("../lib/auth/recovery-flow.ts", import.meta.url),
  "utf8",
);
const tenantHardeningScript = readFileSync(
  new URL("../scripts/verify-tenant-hardening.ts", import.meta.url),
  "utf8",
);
const authProvisioningScript = readFileSync(
  new URL("../scripts/verify-auth-provisioning.ts", import.meta.url),
  "utf8",
);
const bootstrapScript = readFileSync(
  new URL("../scripts/bootstrap-first-company.ts", import.meta.url),
  "utf8",
);
const authRollout = readFileSync(
  new URL("../docs/auth-rollout.md", import.meta.url),
  "utf8",
);
const rollbackProvisionedRealtor = readFileSync(
  new URL("../lib/auth/rollback-provisioned-realtor.ts", import.meta.url),
  "utf8",
);
const provisionRealtor = readFileSync(
  new URL("../lib/auth/provision-realtor.ts", import.meta.url),
  "utf8",
);
const passwordUpdatedPage = readFileSync(
  new URL("../app/auth/password-updated/page.tsx", import.meta.url),
  "utf8",
);
const middlewareSource = readFileSync(
  new URL("../middleware.ts", import.meta.url),
  "utf8",
);
const bookingLayout = readFileSync(
  new URL("../app/book/layout.tsx", import.meta.url),
  "utf8",
);
const bookingAdminAction = readFileSync(
  new URL("../app/admin/bookings/[id]/actions.ts", import.meta.url),
  "utf8",
);
const authLayout = readFileSync(
  new URL("../app/auth/layout.tsx", import.meta.url),
  "utf8",
);
const oauthCompletePage = readFileSync(
  new URL("../app/start/oauth/complete/page.tsx", import.meta.url),
  "utf8",
);
const startAction = readFileSync(
  new URL("../app/start/actions.ts", import.meta.url),
  "utf8",
);
const startPage = readFileSync(
  new URL("../app/start/page.tsx", import.meta.url),
  "utf8",
);
const quarantineMigrationUrl = new URL(
  "../supabase/migrations/20260717140806_quarantine_unprovisioned_auth_users.sql",
  import.meta.url,
);
const migrationSource = readFileSync(quarantineMigrationUrl, "utf8");
const metadataProvisioningMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260717211142_auth_user_metadata_update_provisioning.sql",
    import.meta.url,
  ),
  "utf8",
);

test("privileged company membership routes to the admin workspace", () => {
  assert.equal(
    resolveAccountDestination({
      profile: {
        role: "admin",
        organizationId: "org-company",
        archivedAt: null,
      },
      memberships: [
        { organizationId: "org-company", role: "owner" },
      ],
      requestedPath: "/admin/settings",
    }),
    "/admin/settings",
  );
});

test("realtor profile routes to the portal even when company was requested", () => {
  assert.equal(
    resolveAccountDestination({
      profile: {
        role: "realtor",
        organizationId: "org-company",
        archivedAt: null,
      },
      memberships: [],
      requestedPath: "/admin",
    }),
    "/portal",
  );
});

test("archived, missing, and unprivileged company profiles fail closed", () => {
  assert.equal(
    resolveAccountDestination({
      profile: null,
      memberships: [],
      requestedPath: "/admin",
    }),
    "/auth/no-workspace",
  );
  assert.equal(
    resolveAccountDestination({
      profile: {
        role: "realtor",
        organizationId: "org-company",
        archivedAt: "2026-07-17T00:00:00.000Z",
      },
      memberships: [],
      requestedPath: "/portal",
    }),
    "/auth/no-workspace",
  );
  assert.equal(
    resolveAccountDestination({
      profile: {
        role: "admin",
        organizationId: "org-company",
        archivedAt: null,
      },
      memberships: [
        { organizationId: "org-company", role: "member" },
      ],
      requestedPath: "/admin",
    }),
    "/auth/no-workspace",
  );
});

test("role destinations reject cross-workspace and external requested paths", () => {
  const company = {
    profile: {
      role: "admin",
      organizationId: "org-company",
      archivedAt: null,
    },
    memberships: [
      { organizationId: "org-company", role: "admin" },
    ],
  };
  assert.equal(
    resolveAccountDestination({
      ...company,
      requestedPath: "/portal",
    }),
    "/admin",
  );
  assert.equal(
    resolveAccountDestination({
      ...company,
      requestedPath: "https://evil.example",
    }),
    "/admin",
  );
});

test("post-auth continuation is normalized and restricted by audience", () => {
  assert.equal(
    buildLoginContinuationPath("company", "/admin/settings"),
    "/auth/continue?audience=company&next=%2Fadmin%2Fsettings",
  );
  assert.equal(
    buildLoginContinuationPath("realtor", "/admin"),
    "/auth/continue?audience=realtor&next=%2Fportal",
  );
  assert.equal(
    buildLoginContinuationPath(
      "company",
      "/auth/continue?audience=company&next=%2Fadmin%2Fsettings%2Fintegrations%3Fprovider%3Dgoogle",
    ),
    "/auth/continue?audience=company&next=%2Fadmin%2Fsettings%2Fintegrations%3Fprovider%3Dgoogle",
  );
  assert.equal(
    buildLoginContinuationPath(
      "realtor",
      "/auth/continue?audience=realtor&next=%2Fportal%2Fproperty-123",
    ),
    "/auth/continue?audience=realtor&next=%2Fportal%2Fproperty-123",
  );
  assert.equal(
    safePostAuthPath(
      "/auth/continue?audience=company&next=https%3A%2F%2Fevil.example",
    ),
    "/auth/continue?audience=company&next=%2Fadmin",
  );
  assert.equal(safePostAuthPath("//evil.example"), "/auth/continue");
  assert.equal(
    safePostAuthPath("/start/oauth/complete"),
    "/auth/continue",
  );
  const flow = `1720000000000.00000000-0000-4000-8000-000000000000.${"A".repeat(43)}`;
  assert.equal(
    safePostAuthPath(`/start/oauth/complete?flow=${flow}`),
    "/auth/continue",
  );
  assert.equal(
    safePostAuthPath("/start/oauth/anything-else"),
    "/auth/continue",
  );
  assert.equal(
    safePostAuthPath("/auth/reset/confirm"),
    "/auth/continue",
  );
  assert.equal(
    safePostAuthPath("/auth/reset/anything-else"),
    "/auth/continue",
  );
});

test("login starts with distinct company and realtor entrances", () => {
  assert.match(signInPage, /Photography company/);
  assert.match(signInPage, /Realtor or agent/);
  assert.match(signInPage, /audience=company/);
  assert.match(signInPage, /audience=realtor/);
  assert.match(signInPage, /Invitation required during beta/i);
  assert.doesNotMatch(signInPage, /<OAuthButtons/);
  assert.doesNotMatch(passwordPage, /<OAuthButtons/);
});

test("ordinary login always passes through authoritative account routing", () => {
  assert.match(passwordAction, /safePostAuthPath/);
  assert.match(magicAction, /safePostAuthPath/);
  assert.match(magicAction, /shouldCreateUser:\s*false/);
  assert.match(authCallback, /safePostAuthPath/);

  const continueRoute = new URL("../app/auth/continue/route.ts", import.meta.url);
  assert.equal(existsSync(continueRoute), true);
  const continueSource = readFileSync(continueRoute, "utf8");
  assert.match(continueSource, /auth\.getUser\(\)/);
  assert.match(continueSource, /resolveAccountDestination/);
  assert.match(continueSource, /organization_members/);
  assert.match(continueSource, /\.eq\("profile_id", user\.id\)/);
});

test("ordinary OAuth cannot create an unassigned account", () => {
  assert.doesNotMatch(oauthAction, /signInWithOAuth/);
  assert.match(oauthAction, /signup_disabled/);
});

test("public company provisioning is closed unconditionally during beta", () => {
  assert.doesNotMatch(startAction, /createCompanyWorkspace\(/);
  assert.match(startAction, /Company signup is currently closed/);
  assert.match(startPage, /notFound\(\)/);
  assert.doesNotMatch(startPage, /ENABLE_PUBLIC_SIGNUP/);
  assert.match(oauthCompletePage, /notFound\(\)/);
  assert.doesNotMatch(oauthCompletePage, /createCompanyWorkspaceForExistingUser/);
});

test("only trusted service provisioning can create realtor profiles", () => {
  assert.equal(existsSync(quarantineMigrationUrl), true);
  const migration = readFileSync(quarantineMigrationUrl, "utf8");
  assert.match(migration, /public signup is disabled/i);
  assert.match(
    migration,
    /if not \(new\.raw_app_meta_data \? 'realtor_organization_id'\)[\s\S]*raise exception/i,
  );
  assert.match(
    migration,
    /update auth\.users[\s\S]*from public\.profiles[\s\S]*public\.bookings/i,
  );
  assert.match(migration, /unreviewed realtor profile/i);
  assert.match(migration, /cross-tenant booking owner\/profile mismatch/i);
  assert.match(migration, /b\.organization_id = p\.organization_id/);
  assert.match(migration, /marker\.marker_value::uuid/);
  assert.match(
    migration,
    /parsed_organization_id is distinct from marker\.organization_id/,
  );
  assert.match(migration, /from public\.organizations[\s\S]*realtor_organization_id/i);
  assert.match(
    migration,
    /insert into public\.profiles[\s\S]*organization_id[\s\S]*'realtor'/i,
  );
  assert.match(provisionRealtor, /realtor_organization_id: organizationId/);
  assert.match(provisionRealtor, /realtor_provisioning_id: provisioningId/);
  assert.match(provisionRealtor, /find_realtor_provisioning_auth_user/);
  for (const caller of [bookingAction, inboxAction, calendarAction]) {
    assert.match(caller, /provisionRealtorAuthUser/);
  }
});

test("trusted provisioning runs when Supabase applies protected app metadata", () => {
  assert.match(
    metadataProvisioningMigration,
    /after insert or update of raw_app_meta_data on auth\.users/,
  );
  assert.match(
    metadataProvisioningMigration,
    /marker-less identity[\s\S]*quarantined/i,
  );
  assert.match(metadataProvisioningMigration, /realtor_organization_id/);
  assert.match(metadataProvisioningMigration, /insert into public\.profiles/);
  assert.doesNotMatch(
    metadataProvisioningMigration,
    /raise exception 'public signup is disabled'/,
  );
});

test("existing Auth identities cannot be moved or reactivated across tenants", () => {
  const calendarProvisioning = calendarAction.slice(
    calendarAction.indexOf("async function findOrCreateRealtor"),
    calendarAction.indexOf("async function findOrCreateProperty"),
  );
  assert.doesNotMatch(calendarProvisioning, /listUsers/);
  assert.match(calendarProvisioning, /profile\.organization_id !== args\.organizationId/);
  assert.match(calendarProvisioning, /profile\.role !== "realtor"/);
  assert.match(calendarProvisioning, /profile\.archived_at/);

  assert.doesNotMatch(inboxAction, /auth\.admin\.listUsers/);
  assert.match(inboxAction, /existingProfile\.organization_id !== admin\.organizationId/);
  assert.match(inboxAction, /existingProfile\.role !== "realtor"/);
  assert.match(inboxAction, /existingProfile\.archived_at/);

  const migration = readFileSync(quarantineMigrationUrl, "utf8");
  assert.match(migration, /booking owner is not an active realtor in this organization/i);
  assert.doesNotMatch(migration, /set organization_id = p_organization_id/);
});

test("failed booking workflows revoke identities created in that request", () => {
  assert.match(rollbackProvisionedRealtor, /quarantine_unbooked_realtor/);
  assert.match(rollbackProvisionedRealtor, /deleteUser/);
  assert.match(rollbackProvisionedRealtor, /provisioning_cleanup_events/);
  assert.match(rollbackProvisionedRealtor, /catch \(error\)/);
  assert.match(rollbackProvisionedRealtor, /identity preserved/);
  assert.doesNotMatch(rollbackProvisionedRealtor, /legacyCompatibilityQuarantine/);
  assert.match(migrationSource, /create or replace function public\.quarantine_unbooked_realtor/);
  assert.match(migrationSource, /role in \('owner', 'admin'\)/);
  assert.match(migrationSource, /return 'retained'/);
  assert.match(inboxAction, /createdUserInRequest = true/);
  assert.match(
    inboxAction,
    /transactional accept failed[\s\S]*rollbackProvisionedRealtor/,
  );
  assert.match(calendarAction, /newlyCreated: true/);
  assert.match(
    calendarAction,
    /booking insert failed[\s\S]*rollbackProvisionedRealtor/,
  );
  assert.match(bookingAction, /newlyCreated:\s*true/);
  assert.match(
    bookingAction,
    /sign-in after create failed[\s\S]*rollbackProvisionedRealtor/,
  );
  assert.match(
    bookingAction,
    /atomic booking commit failed[\s\S]*rollbackProvisionedRealtor/,
  );
  assert.ok(
    bookingAction.indexOf("setSupabaseSessionCookie(authResult.sessionTokens") >
      bookingAction.indexOf("if (bookErr || !atomic?.booking_id"),
  );
});

test("unlinked users get a recovery page instead of a guessed realtor role", () => {
  const noWorkspacePage = new URL(
    "../app/auth/no-workspace/page.tsx",
    import.meta.url,
  );
  assert.equal(existsSync(noWorkspacePage), true);
  const source = readFileSync(noWorkspacePage, "utf8");
  assert.match(source, /isn(?:.t|&apos;t) linked to a workspace/i);
  assert.match(source, /invitation/i);
  assert.doesNotMatch(source, /Book a shoot/i);
  assert.match(source, /contact support/i);
  assert.match(source, /mailto:info@pixelblastermedia\.com/);
  assert.match(source, /signOut/);
});

test("transient access lookup failures use a neutral retry page", () => {
  const continueRoute = readFileSync(
    new URL("../app/auth/continue/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(continueRoute, /\/auth\/access-unavailable/);
  assert.match(continueRoute, /userError && !isMissingSessionError\(userError\)/);
  assert.match(continueRoute, /safeLoginRequestedPath/);
  assert.match(continueRoute, /authContextUrl\("\/auth\/sign-in", url\)/);
  const unavailable = new URL(
    "../app/auth/access-unavailable/page.tsx",
    import.meta.url,
  );
  assert.equal(existsSync(unavailable), true);
  assert.match(readFileSync(unavailable, "utf8"), /couldn.t verify your access/i);
  assert.match(requireUser, /if \(error\)[\s\S]*\/auth\/access-unavailable/);
  assert.match(requireAdmin, /if \(error\)[\s\S]*\/auth\/access-unavailable/);
  assert.match(requireAdmin, /if \(membershipError\)[\s\S]*\/auth\/access-unavailable/);
});

test("callback and password reset failures route through visible authoritative auth", () => {
  assert.equal(shouldHandoffAuthCode("/admin", true), true);
  assert.equal(shouldHandoffAuthCode("/auth/callback", true), false);
  assert.equal(shouldHandoffAuthCode("/auth/recovery/callback", true), false);
  assert.equal(shouldHandoffAuthCode("/api/example", true), false);
  assert.match(authCallback, /url\.searchParams\.get\("error"\)/);
  assert.match(authCallback, /providerError \? "callback_failed" : "expired"/);
  assert.match(resetConfirmAction, /redirect\("\/auth\/continue\?password_updated=1"\)/);
  assert.match(passwordUpdatedPage, /Your new password is ready/);
  assert.match(passwordUpdatedPage, /Continue to workspace/);
});

test("password changes require a signed single-purpose recovery grant", () => {
  assert.match(resetRequestAction, /createRecoveryFlowToken/);
  assert.match(resetRequestAction, /\/auth\/recovery\/callback/);
  assert.match(recoveryCallback, /verifyRecoveryFlowToken/);
  assert.match(recoveryCallback, /RECOVERY_GRANT_COOKIE/);
  assert.match(recoveryFlow, /createHmac\("sha256"/);
  assert.match(recoveryFlow, /timingSafeEqual/);
  assert.match(recoveryFlow, /jtiHash/);
  assert.match(resetConfirmAction, /verifyRecoveryGrant/);
  assert.match(resetConfirmAction, /consume_auth_recovery_grant/);
  assert.match(resetConfirmAction, /reset transport failed/);
  assert.match(resetConfirmAction, /clearRecoverySession/);
  const resetConfirmForm = readFileSync(
    new URL("../app/auth/reset/confirm/ResetConfirmForm.tsx", import.meta.url),
    "utf8",
  );
  assert.match(resetConfirmForm, /Request a new reset link/);
  assert.match(recoveryCallback, /failure session cleanup threw/);
  assert.match(recoveryCallback, /remote session cleanup failed/);
  assert.match(recoveryCallback, /sb-.+-auth-token/);
  assert.match(migrationSource, /consumed_at is null/);
  assert.doesNotMatch(magicAction, /reset\/confirm/);
});

test("public booking rejects company workspace identities", () => {
  assert.match(bookingAction, /profile\.role !== "realtor"/);
  assert.match(bookingAction, /hasPrivilegedCompanyMembership/);
  assert.match(bookingAction, /company workspace account, not a realtor portal account/i);
});

test("magic-link password fallback preserves the normalized deep destination", () => {
  assert.match(magicPage, /next:\s*continuation/);
});

test("tenant hardening canary uses explicit trusted provisioning", () => {
  assert.match(tenantHardeningScript, /realtor_organization_id/);
  assert.match(tenantHardeningScript, /realtor_provisioning_id/);
  assert.match(tenantHardeningScript, /company_invitation_id/);
  assert.match(tenantHardeningScript, /\.upsert\(/);
});

test("auth provisioning has an executable fail-closed canary", () => {
  assert.match(authProvisioningScript, /anonymous signup unexpectedly/);
  assert.match(authProvisioningScript, /company_invitation_id/);
  assert.match(authProvisioningScript, /realtor_organization_id/);
  assert.match(authProvisioningScript, /not-a-uuid/);
  assert.match(authProvisioningScript, /cleanupErrors/);
  assert.match(authProvisioningScript, /lookup\.error\.status !== 404/);
  assert.match(authProvisioningScript, /listUsers/);
  assert.match(authProvisioningScript, /organization_members/);
  assert.match(
    authProvisioningScript,
    /from\("organization_members"\)[\s\S]*select\("profile_id"[\s\S]*\.in\("profile_id", ids\)/,
  );
  assert.match(
    authProvisioningScript,
    /from\("bookings"\)[\s\S]*\.in\("owner_id", ids\)/,
  );
  assert.match(authProvisioningScript, /auth_recovery_grants/);
  assert.match(authProvisioningScript, /provisioning_cleanup_events/);
});

test("fresh setup has a guarded one-time owner bootstrap and rollout order", () => {
  assert.match(bootstrapScript, /organization_members/);
  assert.match(bootstrapScript, /owner", "admin/);
  assert.match(bootstrapScript, /Bootstrap refused/);
  assert.match(bootstrapScript, /company_invitation_id/);
  assert.match(bootstrapScript, /stateCommitted = true/);
  assert.match(bootstrapScript, /AbortSignal\.timeout/);
  assert.match(bootstrapScript, /Keep the owner account/);
  assert.match(bootstrapScript, /bootstrap_first_company_owner/);
  assert.match(bootstrapScript, /BOOTSTRAP_INVITATION_ID/);
  assert.match(bootstrapScript, /preserveIdentity/);
  assert.match(bootstrapScript, /Post-claim verification is unresolved/);
  assert.match(migrationSource, /pg_advisory_xact_lock/);
  assert.match(authRollout, /Disable public Auth signup/i);
  assert.match(authRollout, /ENABLE_PUBLIC_SIGNUP=0/);
  assert.match(authRollout, /Do not use `supabase db push --include-all`/);
  assert.match(
    authRollout,
    /migration repair --linked --status applied 20260717140806/,
  );
});

test("auth errors remain visible before an audience is selected", () => {
  assert.match(signInPage, /invalid_invitation/);
  assert.match(signInPage, /signup_disabled/);
  assert.ok(signInPage.indexOf("AuthError") < signInPage.indexOf("AudienceChooser"));
});

test("every known realtor login producer carries realtor audience", () => {
  assert.match(middlewareSource, /audience.*realtor/);
  assert.doesNotMatch(bookingLayout, /auth\/sign-in\?next=\/portal/);
  assert.match(bookingLayout, /audience=realtor/);
  assert.match(inboxAction, /searchParams\.set\("audience", "realtor"\)/);
  assert.match(bookingAdminAction, /searchParams\.set\("audience", "realtor"\)/);
});

test("auth layout does not create negative-margin mobile overflow", () => {
  assert.doesNotMatch(authLayout, /-mx-6/);
  assert.match(authLayout, /max-w-full/);
});

test("new auth actions expose touch-sized keyboard focus targets", () => {
  assert.match(signInPage, /focus-visible:outline/);
  assert.match(passwordUpdatedPage, /min-h-11/);
  const noWorkspace = readFileSync(
    new URL("../app/auth/no-workspace/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(noWorkspace, /min-h-11/);
  assert.match(noWorkspace, /focus-visible:outline/);
});

test("anonymous navigation offers one login entry and no public company signup", () => {
  assert.doesNotMatch(rootLayout, /href: "\/start", label: "Sign up"/);
  assert.match(rootLayout, /href: "\/auth\/sign-in", label: "Log in"/);
  assert.match(
    rootLayout,
    /href: "\/auth\/sign-in\?audience=realtor&next=%2Fportal"/,
  );
});

test("protected workspaces preselect their correct login audience", () => {
  assert.match(requireAdmin, /audience=company/);
  assert.match(requireAdmin, /profile\.role === "realtor" \? "\/portal" : "\/auth\/no-workspace"/);
  assert.match(requireUser, /audience=realtor/);
  assert.match(requireUser, /if \(profile\.archived_at\)/);
});
