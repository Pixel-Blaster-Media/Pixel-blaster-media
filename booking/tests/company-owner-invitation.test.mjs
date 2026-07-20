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
const { safeAppOrigin, safeNextPath } = await import(
  "../lib/auth/safe-next-path.ts"
);

test("platform company onboarding sends stable owner sign-in instructions without collecting a password", () => {
  assert.doesNotMatch(companyFormSource, /name="admin_password"/);
  assert.doesNotMatch(companyActionSource, /formData\.get\("admin_password"\)/);
  assert.match(companyFormSource, /invitation/i);
  assert.match(companyActionSource, /createCompanyWorkspaceWithInvitation/);
  assert.doesNotMatch(companySetupSource, /generateLink\(\{/);
  assert.doesNotMatch(companySetupSource, /properties\?\.hashed_token/);
  assert.doesNotMatch(companySetupSource, /new URL\("\/auth\/confirm"/);
  assert.match(companySetupSource, /new URL\("\/auth\/magic",\s*appUrl\)/);
  assert.match(companySetupSource, /searchParams\.set\("audience",\s*"company"\)/);
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
  const signInLink = invitation.indexOf('new URL("/auth/magic", appUrl)');
  assert.ok(createUser >= 0 && createUser < createOrganization);
  assert.ok(createOrganization < signInLink);
  assert.doesNotMatch(invitation, /emailHasAccount\(/);
  assert.match(invitation, /createdUserId\s*=\s*created\.user\.id/);
  assert.match(invitation, /beta_provisioning_key:\s*input\.authProvisioningKey/);
  assert.match(
    invitation,
    /const recoveryIds = input\.invitationId && input\.organizationId[\s\S]*invitationRecoveryIds\(input\.adminEmail\)/,
  );
  assert.match(invitation, /Incomplete company invitation recovery state/);
  assert.doesNotMatch(invitation, /randomUUID\(/);
  assert.match(invitation, /idempotencyKey:\s*`company-owner-invite:\$\{invitationId\}`/);
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
  assert.match(
    source,
    /safeAppOrigin\(\s*process\.env\.NEXT_PUBLIC_APP_URL,\s*url\.origin,?\s*\)/,
  );
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

test("invitation confirmation redirects to the configured canonical app origin", () => {
  assert.equal(
    safeAppOrigin(
      "https://www.pixelblastermedia.com",
      "https://internal.vercel.app",
    ),
    "https://www.pixelblastermedia.com",
  );
  assert.equal(
    safeAppOrigin("javascript:alert(1)", "https://internal.vercel.app"),
    "https://internal.vercel.app",
  );
});
