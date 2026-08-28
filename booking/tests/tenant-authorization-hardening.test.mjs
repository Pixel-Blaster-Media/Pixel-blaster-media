import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260716183000_emergency_tenant_authorization_hardening.sql",
  import.meta.url,
);
const requireAdminSource = readFileSync(
  new URL("../lib/auth/require-admin.ts", import.meta.url),
  "utf8",
);
const requirePlatformAdminSource = readFileSync(
  new URL("../lib/auth/require-platform-admin.ts", import.meta.url),
  "utf8",
);
const platformAdminAccessSource = readFileSync(
  new URL("../lib/auth/platform-admin-access-core.ts", import.meta.url),
  "utf8",
);
const requestVerifiedIdentitySource = readFileSync(
  new URL("../lib/auth/request-verified-identity.ts", import.meta.url),
  "utf8",
);
const bookingDetailSource = readFileSync(
  new URL("../app/admin/bookings/[id]/page.tsx", import.meta.url),
  "utf8",
);
const integrationsSettingsSource = readFileSync(
  new URL("../app/admin/settings/integrations/page.tsx", import.meta.url),
  "utf8",
);

test("emergency migration blocks self-promotion and removes global admin policies", () => {
  assert.equal(existsSync(migrationUrl), true, "missing emergency tenant migration");
  const sql = readFileSync(migrationUrl, "utf8");

  assert.match(sql, /old\.role\s+is\s+distinct\s+from\s+new\.role/i);
  assert.match(sql, /old\.organization_id\s+is\s+distinct\s+from\s+new\.organization_id/i);
  assert.match(sql, /old\.email\s+is\s+distinct\s+from\s+new\.email/i);
  assert.match(sql, /raise exception 'Profile authorization fields cannot be changed'/i);
  assert.match(sql, /\(select auth\.uid\(\)\) is not null/i);

  assert.match(sql, /create or replace function public\.is_organization_admin/i);
  assert.match(sql, /p\.archived_at is null/i);
  assert.match(sql, /om\.organization_id = p\.organization_id/i);
  assert.match(sql, /create trigger organization_members_enforce_profile_organization/i);
  assert.match(sql, /Membership organization must match profile organization/i);

  assert.match(sql, /drop policy if exists "organizations: admin read"/i);
  assert.match(sql, /drop policy if exists "organizations: admin write"/i);
  assert.match(sql, /using \(public\.is_organization_admin\(id\)\)/i);
  assert.match(
    sql,
    /revoke all on function public\.is_admin\(\)\s+from public, anon, authenticated/i,
  );

  assert.match(sql, /drop policy if exists "organization_members: self or admin read"/i);
  assert.match(sql, /drop policy if exists "organization_members: admin write"/i);
  assert.match(sql, /public\.is_organization_admin\(organization_id\)/i);

  for (const policy of [
    "google_calendar_connection: admin read",
    "google_calendar_connection: admin write",
    "booking_notifications_admin_all",
    "integration_credentials: org admin read",
    "integration_credentials: org admin write",
    "quickbooks_connection: org admin read",
    "quickbooks_connection: org admin write",
  ]) {
    assert.match(sql, new RegExp(`drop policy if exists "${policy}"`, "i"));
  }
});

test("admin authorization is derived from an owner or admin membership", () => {
  assert.match(requireAdminSource, /\.from\("organization_members"\)/);
  assert.match(requireAdminSource, /\.in\("role", \["owner", "admin"\]\)/);
  assert.doesNotMatch(requireAdminSource, /profile\.role !== "admin"/);
});

test("platform authorization uses verified auth identity and fails closed", () => {
  assert.doesNotMatch(requirePlatformAdminSource, /DEFAULT_ORGANIZATION_ID/);
  assert.match(requestVerifiedIdentitySource, /supabase\.auth\.getUser\(\)/);
  assert.doesNotMatch(requirePlatformAdminSource, /getRequestVerifiedIdentity/);
  assert.match(requirePlatformAdminSource, /user: admin\.verifiedIdentity/);
  assert.match(requirePlatformAdminSource, /hasVerifiedPlatformAdminAccess/);
  assert.match(platformAdminAccessSource, /identity\.kind !== "authenticated"/);
  assert.match(platformAdminAccessSource, /identity\.user\.id !== adminUserId/);
  assert.match(platformAdminAccessSource, /identity\.user\.email\.toLowerCase\(\)/);
  assert.doesNotMatch(requirePlatformAdminSource, /admin\.email\.toLowerCase\(\)/);
  assert.doesNotMatch(requirePlatformAdminSource, /auth\.getSession\(\)/);
  assert.match(requirePlatformAdminSource, /explicitEmails\.length === 0/);
  assert.match(requirePlatformAdminSource, /!admin\.verifiedIdentity/);
});

test("notification status is loaded only after a tenant-scoped booking is proven", () => {
  assert.match(bookingDetailSource, /getServiceSupabase/);
  const tenantCheck = bookingDetailSource.indexOf(
    '.eq("organization_id", admin.organizationId)',
  );
  const notFoundCheck = bookingDetailSource.indexOf(
    "if (bookErr || !booking) notFound()",
  );
  const notificationRead = bookingDetailSource.indexOf(
    '.from("booking_notifications")',
  );
  assert.ok(tenantCheck >= 0 && tenantCheck < notFoundCheck);
  assert.ok(notFoundCheck < notificationRead);
});

test("QuickBooks settings use the service client with an organization filter", () => {
  assert.match(integrationsSettingsSource, /getServiceSupabase/);
  assert.doesNotMatch(integrationsSettingsSource, /getServerSupabase/);
  assert.match(integrationsSettingsSource, /\.from\("quickbooks_connection"\)/);
  assert.match(
    integrationsSettingsSource,
    /\.eq\("organization_id", admin\.organizationId\)/,
  );
});
