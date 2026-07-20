import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const coreUrl = new URL("../lib/platform/beta-invite-core.ts", import.meta.url);
const migrationUrl = new URL(
  "../supabase/migrations/20260720120000_beta_company_invitations.sql",
  import.meta.url,
);
const postgresRunner = readFileSync(
  new URL("../scripts/verify-atomic-booking-postgres.sh", import.meta.url),
  "utf8",
);
const betaBehaviorUrl = new URL(
  "./postgres/beta-company-invitations.behavior.sql",
  import.meta.url,
);
const betaInvitesUrl = new URL("../lib/platform/beta-invites.ts", import.meta.url);
const adminActionsUrl = new URL(
  "../app/admin/settings/companies/beta-invite-actions.ts",
  import.meta.url,
);
const adminFormUrl = new URL(
  "../app/admin/settings/companies/IssueBetaInviteForm.tsx",
  import.meta.url,
);
const adminMutationFormUrl = new URL(
  "../app/admin/settings/companies/BetaAdminMutationForm.tsx",
  import.meta.url,
);
const betaJoinRouteUrl = new URL("../app/beta/join/route.ts", import.meta.url);
const betaPageUrl = new URL("../app/beta/onboarding/page.tsx", import.meta.url);
const betaFormUrl = new URL("../app/beta/onboarding/BetaCompanyForm.tsx", import.meta.url);
const betaActionsUrl = new URL("../app/beta/onboarding/actions.ts", import.meta.url);
const publicBookingResolverUrl = new URL(
  "../lib/organizations/public-booking.ts",
  import.meta.url,
);

test("beta invite tokens are random, opaque, and stored only by hash", async () => {
  assert.equal(existsSync(coreUrl), true, "missing beta invite token core");
  const { createBetaInviteToken, hashBetaInviteToken } = await import(coreUrl);

  const first = createBetaInviteToken();
  const second = createBetaInviteToken();

  assert.match(first.rawToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(first.tokenHash, hashBetaInviteToken(first.rawToken));
  assert.notEqual(first.rawToken, second.rawToken);
  assert.notEqual(first.tokenHash, second.tokenHash);
  assert.doesNotMatch(first.tokenHash, new RegExp(first.rawToken));
});

test("beta invitations fail closed after expiry, revocation, or consumption", async () => {
  assert.equal(existsSync(coreUrl), true, "missing beta invite token core");
  const { isBetaInviteUsable } = await import(coreUrl);
  const now = new Date("2026-07-20T12:00:00.000Z");
  const active = {
    expiresAt: "2026-07-27T12:00:00.000Z",
    consumedAt: null,
    revokedAt: null,
  };

  assert.equal(isBetaInviteUsable(active, now), true);
  assert.equal(
    isBetaInviteUsable({ ...active, expiresAt: now.toISOString() }, now),
    false,
  );
  assert.equal(
    isBetaInviteUsable({ ...active, revokedAt: now.toISOString() }, now),
    false,
  );
  assert.equal(
    isBetaInviteUsable({ ...active, consumedAt: now.toISOString() }, now),
    false,
  );
  assert.equal(
    isBetaInviteUsable({ ...active, expiresAt: "not-a-date" }, now),
    false,
  );
});

test("beta invite persistence is service-only, email-bound, expiring, and single-use", () => {
  assert.equal(existsSync(migrationUrl), true, "missing beta invite migration");
  const migration = readFileSync(migrationUrl, "utf8");

  assert.match(migration, /create table public\.beta_company_invites/i);
  assert.match(migration, /token_hash\s+text\s+not null\s+unique/i);
  assert.match(migration, /length\(token_hash\)\s*=\s*64/i);
  assert.match(migration, /email\s+text\s+not null/i);
  assert.match(migration, /expires_at\s+timestamptz\s+not null/i);
  assert.match(migration, /consumed_at\s+timestamptz/i);
  assert.match(migration, /revoked_at\s+timestamptz/i);
  assert.match(migration, /foreign key \(organization_id\)[\s\S]*references public\.organizations\(id\) on delete restrict/i);
  assert.match(migration, /delivery_status\s+text\s+not null/i);
  assert.match(migration, /status\s+text\s+not null/i);
  assert.match(migration, /company_name\s+text/i);
  assert.match(migration, /company_slug\s+text/i);
  assert.match(migration, /provisioning_deadline\s+timestamptz/i);
  assert.match(migration, /alter table public\.organizations[\s\S]*lifecycle_status/i);
  assert.match(migration, /beta_invitation_id\s+uuid/i);
  assert.match(migration, /create or replace function public\.protect_beta_organization_lifecycle/i);
  assert.match(migration, /auth\.uid\(\)[\s\S]*lifecycle_status/i);
  assert.match(migration, /create trigger protect_beta_organization_lifecycle/i);
  assert.match(migration, /create or replace function public\.find_beta_auth_user_by_email/i);
  assert.match(migration, /create or replace function public\.guard_beta_auth_email_reservation/i);
  assert.match(migration, /create trigger guard_beta_auth_email_reservation/i);
  assert.match(migration, /beta_provisioning_key/i);
  assert.match(migration, /extensions\.gen_random_bytes\(32\)/i);
  assert.doesNotMatch(migration, /gen_random_uuid\(\)::text\s*\|\|\s*gen_random_uuid\(\)::text/i);
  assert.match(migration, /create or replace function public\.resume_beta_company_onboarding/i);
  assert.match(migration, /create or replace function public\.begin_beta_company_onboarding/i);
  assert.match(migration, /status = 'provisioning'/i);
  assert.match(migration, /company inputs do not match/i);
  assert.match(migration, /lifecycle_status[\s\S]*'onboarding'/i);
  assert.match(migration, /create or replace function public\.complete_beta_company_onboarding/i);
  assert.match(migration, /raw_app_meta_data[\s\S]*company_invitation_id/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /create or replace function public\.issue_beta_company_invite/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /lower\(btrim\(p_email\)\)/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /invite\.expires_at\s*<=\s*pg_catalog\.now\(\)/i);
  assert.match(migration, /invite\.revoked_at is not null/i);
  assert.match(migration, /invite\.consumed_at is not null/i);
  assert.match(migration, /lower\(p\.email\)\s*=\s*invite\.email/i);
  assert.match(migration, /om\.role\s*=\s*'owner'/i);
  assert.match(migration, /revoke all on table public\.beta_company_invites from public/i);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function[\s\S]*to service_role/i);
});

test("PostgreSQL behavior proves retry preservation, owner binding, activation, and reconciliation", () => {
  assert.equal(existsSync(betaBehaviorUrl), true, "missing beta invite PostgreSQL behavior test");
  const behavior = readFileSync(betaBehaviorUrl, "utf8");

  assert.match(postgresRunner, /20260720120000_beta_company_invitations\.sql/);
  assert.match(postgresRunner, /beta-company-invitations\.behavior\.sql/);
  assert.match(behavior, /ambiguous retry did not preserve the first invitation/i);
  assert.match(behavior, /expired beta invite was accepted/i);
  assert.match(behavior, /owner mismatch was accepted/i);
  assert.match(behavior, /same-owner replay was not idempotent/i);
  assert.match(behavior, /completed owner retained beta provisioning capability/i);
  assert.match(behavior, /tenant owner bypassed platform lifecycle activation/i);
  assert.match(behavior, /profileless Auth identity received a second invitation/i);
  assert.match(behavior, /issued beta email was not reserved from external Auth creation/i);
  assert.match(behavior, /beta provisioning key was not 32 random bytes/i);
  assert.match(behavior, /active provisioning window was reconciled early/i);
  assert.match(behavior, /operator reconciliation did not resume provisioning/i);
});

test("only a platform admin can issue or revoke an email-bound beta invitation", () => {
  for (const url of [betaInvitesUrl, adminActionsUrl, adminFormUrl]) {
    assert.equal(existsSync(url), true, `missing ${url.pathname}`);
  }
  const service = readFileSync(betaInvitesUrl, "utf8");
  const actions = readFileSync(adminActionsUrl, "utf8");
  const form = readFileSync(adminFormUrl, "utf8");
  assert.equal(existsSync(adminMutationFormUrl), true);
  const mutationForm = readFileSync(adminMutationFormUrl, "utf8");

  assert.match(actions, /requirePlatformAdmin\(\)/);
  assert.match(actions, /process\.env\.BETA_COMPANY_ONBOARDING_ENABLED\s*!==\s*"true"/);
  assert.match(actions, /issueBetaCompanyInvite/);
  assert.match(actions, /revokeBetaCompanyInvite/);
  assert.match(service, /createBetaInviteToken\(\)/);
  assert.doesNotMatch(service, /emailHasAccount\(/);
  assert.match(service, /service\.rpc\(\s*"find_beta_auth_user_by_email"/);
  assert.match(service, /service\.rpc\(\s*"issue_beta_company_invite"/);
  assert.match(service, /!issued\.created/);
  assert.match(service, /new URL\("\/beta\/join",\s*appUrl\)/);
  assert.match(service, /service\.rpc\(\s*"mark_beta_company_invite_delivery"/);
  assert.match(service, /sendEmail\(\{[\s\S]*organizationId:\s*DEFAULT_ORGANIZATION_ID/);
  assert.match(service, /idempotencyKey:/);
  assert.doesNotMatch(service, /console\.(?:log|info|warn|error)\([^\n]*rawToken/);
  assert.doesNotMatch(actions, /rawToken/);
  assert.match(form, /type="email"/);
  assert.match(form, /Invite beta company/);
  assert.doesNotMatch(form, /company_name|admin_name|primary_color/);
  assert.match(actions, /reconcileBetaCompany/);
  assert.match(actions, /return \{ ok: false, error:/);
  assert.match(mutationForm, /useActionState/);
  assert.match(mutationForm, /state\.error/);
});

test("a valid beta link lets only its bound email create one isolated company", () => {
  for (const url of [betaJoinRouteUrl, betaPageUrl, betaFormUrl, betaActionsUrl]) {
    assert.equal(existsSync(url), true, `missing ${url.pathname}`);
  }
  const join = readFileSync(betaJoinRouteUrl, "utf8");
  const page = readFileSync(betaPageUrl, "utf8");
  const form = readFileSync(betaFormUrl, "utf8");
  const actions = readFileSync(betaActionsUrl, "utf8");
  const service = readFileSync(betaInvitesUrl, "utf8");
  const resolver = readFileSync(publicBookingResolverUrl, "utf8");

  assert.match(join, /getActiveBetaCompanyInvite\(token\)/);
  assert.match(join, /BETA_INVITE_COOKIE/);
  assert.match(join, /httpOnly:\s*true/);
  assert.match(join, /secure:\s*true/);
  assert.match(join, /sameSite:\s*"strict"/);
  assert.match(join, /new URL\("\/beta\/onboarding",\s*url\.origin\)/);
  assert.match(join, /NextResponse\.redirect\(destination,\s*303\)/);
  assert.match(page, /robots:\s*\{\s*index:\s*false/);
  assert.match(page, /referrer:\s*"no-referrer"/);
  assert.match(page, /cookies\(\)/);
  assert.match(page, /getActiveBetaCompanyInvite\(token\)/);
  assert.match(page, /This beta invitation is invalid, expired, used, or revoked/);
  assert.doesNotMatch(form, /name="token"/);
  assert.match(form, /name="company_name"/);
  assert.match(form, /name="slug"/);
  assert.match(form, /name="admin_name"/);
  assert.match(form, /name="copy_catalog"/);
  assert.doesNotMatch(form, /name="admin_email"/);
  assert.doesNotMatch(form, /name="password"|type="password"/i);
  assert.match(actions, /cookies\(\)/);
  assert.match(actions, /getActiveBetaCompanyInvite\(token\)/);
  assert.match(actions, /service\.rpc\(\s*"begin_beta_company_onboarding"/);
  assert.match(actions, /adminEmail:\s*invite\.email/);
  assert.match(actions, /invitationId:\s*invite\.id/);
  assert.match(actions, /organizationId:\s*begin\.organization_id/);
  assert.match(actions, /sourceCatalogOrganizationId:\s*DEFAULT_ORGANIZATION_ID/);
  assert.match(actions, /createCompanyWorkspaceWithInvitation/);
  assert.match(actions, /service\.rpc\(\s*"complete_beta_company_onboarding"/);
  assert.doesNotMatch(actions, /formData\.get\("admin_email"\)/);
  assert.match(service, /isBetaInviteUsable/);
  assert.match(service, /\.eq\("token_hash",\s*tokenHash\)/);
  assert.match(resolver, /\.eq\("lifecycle_status",\s*"active"\)/);
  assert.match(resolver, /if \(!data\) return null/);
  assert.doesNotMatch(resolver, /name:\s*DEFAULT_ORGANIZATION_NAME/);
});
