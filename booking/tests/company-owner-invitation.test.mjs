import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const companyFormSource = readFileSync(
  new URL("../app/admin/settings/companies/CreateCompanyForm.tsx", import.meta.url),
  "utf8",
);
const companyActionSource = readFileSync(
  new URL("../app/admin/settings/companies/actions.ts", import.meta.url),
  "utf8",
);
const companySetupSource = readFileSync(
  new URL("../lib/platform/company-setup.ts", import.meta.url),
  "utf8",
);
const resendSource = readFileSync(
  new URL("../lib/email/resend.ts", import.meta.url),
  "utf8",
);
const recoveryMigrationUrl = new URL(
  "../supabase/migrations/20260716223000_company_invitation_auth_recovery.sql",
  import.meta.url,
);
const recoveryMigration = existsSync(recoveryMigrationUrl)
  ? readFileSync(recoveryMigrationUrl, "utf8")
  : "";
const { safeNextPath } = await import("../lib/auth/safe-next-path.ts");

test("platform company onboarding sends a one-time owner invitation instead of collecting a password", () => {
  assert.doesNotMatch(companyFormSource, /name="admin_password"/);
  assert.doesNotMatch(companyActionSource, /formData\.get\("admin_password"\)/);
  assert.match(companyFormSource, /invitation/i);
  assert.match(companyActionSource, /createCompanyWorkspaceWithInvitation/);
  assert.match(companySetupSource, /generateLink\(\{/);
  assert.match(companySetupSource, /type:\s*"magiclink"/);
  assert.match(companySetupSource, /properties\?\.hashed_token/);
  assert.match(companySetupSource, /new URL\("\/auth\/confirm",\s*appUrl\)/);
  assert.match(
    companySetupSource,
    /sendEmail\(\{[\s\S]*organizationId:\s*DEFAULT_ORGANIZATION_ID[\s\S]*\}\)/,
  );
  assert.doesNotMatch(
    companySetupSource,
    /sendEmail\(\{[\s\S]*organizationId:\s*organization\.id[\s\S]*\}\)/,
  );
  assert.doesNotMatch(companySetupSource, /properties\?\.action_link/);

  const invitationStart = companySetupSource.indexOf(
    "export async function createCompanyWorkspaceWithInvitation",
  );
  const invitationEnd = companySetupSource.indexOf(
    "export async function createCompanyWorkspaceForExistingUser",
  );
  const invitation = companySetupSource.slice(invitationStart, invitationEnd);
  const createUser = invitation.indexOf("service.auth.admin.createUser({");
  const createOrganization = invitation.indexOf(
    "createOrganization(input, organizationId)",
  );
  const generateLink = invitation.indexOf("service.auth.admin.generateLink({");
  assert.ok(createUser >= 0 && createUser < createOrganization);
  assert.ok(createOrganization < generateLink);
  assert.doesNotMatch(invitation, /emailHasAccount\(/);
  assert.match(invitation, /createdUser\.id\s*!==\s*createdUserId/);
  assert.match(
    invitation,
    /const \{ invitationId, organizationId \} = invitationRecoveryIds\(input\.adminEmail\)/,
  );
  assert.doesNotMatch(invitation, /randomUUID\(/);
  assert.match(
    invitation,
    /app_metadata:\s*\{\s*company_invitation_id:\s*invitationId\s*\}/,
  );
  assert.match(invitation, /recoverInvitationAuthUser\(invitationId\)/);
  assert.match(invitation, /recovery\.status === "unresolved"/);
  assert.match(invitation, /recovery\.status === "found"/);
  assert.doesNotMatch(companySetupSource, /successfulLookup/);
  assert.match(
    companySetupSource,
    /finalStatus = data === null \? "absent" : "unresolved"/,
  );
  assert.match(
    companySetupSource,
    /else \{\s*finalStatus = "unresolved";[\s\S]*invitation user lookup failed/,
  );
  assert.match(
    invitation,
    /if \(createUserError \|\| !created\.user\)[\s\S]*recoverInvitationAuthUser\(invitationId,\s*\{[\s\S]*waitForCommit: true/,
  );
  assert.match(
    invitation,
    /if \(!invitation\.ok \|\| invitation\.skipped\)[\s\S]*ok:\s*true[\s\S]*invitationSent:\s*false/,
  );
  assert.match(invitation, /recoveryReference/);
  assert.match(invitation, /Retry the same email and company handle/);
  assert.doesNotMatch(invitation, /cleanupFailedCompany\(/);
  assert.match(
    companySetupSource,
    /existingOrganization\.slug !== input\.slug[\s\S]*already associated with another company invitation/,
  );
  assert.match(
    companySetupSource,
    /onConflict: "organization_id,slug"[\s\S]*ignoreDuplicates: true/,
  );
  assert.doesNotMatch(companySetupSource, /^\s*await cleanupFailedCompany\(/m);
  assert.match(resendSource, /signal:\s*AbortSignal\.timeout\(/);
  assert.match(recoveryMigration, /from auth\.users/i);
  assert.match(recoveryMigration, /company_invitation_id/i);
  assert.match(
    recoveryMigration,
    /handle_new_auth_user[\s\S]*raw_app_meta_data\s*\?\s*'company_invitation_id'[\s\S]*return new/i,
  );
  assert.match(recoveryMigration, /claim_company_invitation_owner/i);
  assert.match(
    recoveryMigration,
    /existing_profile_org[\s\S]*is distinct from p_organization_id[\s\S]*raise exception/i,
  );
  assert.match(invitation, /service\.rpc\(\s*"claim_company_invitation_owner"/);
  assert.doesNotMatch(
    invitation,
    /service\.from\("profiles"\)\.upsert/,
  );
  assert.match(recoveryMigration, /revoke all on function/i);
  assert.match(recoveryMigration, /revoke all[\s\S]*authenticated/i);
  assert.match(recoveryMigration, /grant execute[\s\S]*service_role/i);
});

test("owner invitation confirms its token hash into a server-side session", () => {
  const confirmRoute = new URL("../app/auth/confirm/route.ts", import.meta.url);
  assert.equal(existsSync(confirmRoute), true, "missing auth confirmation route");
  const source = readFileSync(confirmRoute, "utf8");
  assert.match(source, /verifyOtp\(\{/);
  assert.match(source, /token_hash:\s*tokenHash/);
  assert.match(source, /safeNextPath\(next\)/);
});

test("invitation confirmation accepts only normalized same-origin paths", () => {
  const fallback = "/admin";
  assert.equal(
    safeNextPath("/admin/settings?welcome=1", fallback),
    "/admin/settings?welcome=1",
  );
  assert.equal(safeNextPath("//evil.example", fallback), fallback);
  assert.equal(safeNextPath("/\\evil.example", fallback), fallback);
  assert.equal(safeNextPath("https://evil.example", fallback), fallback);
  assert.equal(safeNextPath("/\t/evil.example", fallback), fallback);
  assert.equal(safeNextPath("/\r/evil.example", fallback), fallback);
  assert.equal(safeNextPath("/\n/evil.example", fallback), fallback);
  assert.equal(
    safeNextPath("/auth/confirm?token_hash=secret", fallback),
    fallback,
  );
});
