import { randomBytes, randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd(), false);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  throw new Error("Supabase public configuration missing");
}

const service = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const publicClient = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const tag = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const password = `${randomBytes(24).toString("base64url")}Aa1!`;
let organizationId: string | null = null;
let invitationUserId: string | null = null;
let trustedUserId: string | null = null;
const trackedAuthIds: string[] = [];
const trackedEmails: string[] = [];

async function expectRejectedUser(
  emailPrefix: string,
  appMetadata: Record<string, string>,
) {
  const email = `${emailPrefix}-${tag}@invalid.pixelblastermedia.com`;
  trackedEmails.push(email);
  const result = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: appMetadata,
  });
  if (result.data.user) trackedAuthIds.push(result.data.user.id);
  if (!result.error || result.data.user) {
    throw new Error(`${emailPrefix} unexpectedly created an Auth user`);
  }
}

async function main() {
try {
  const organization = await service
    .from("organizations")
    .insert({
      name: `[CANARY DELETE] Auth provisioning ${tag}`,
      slug: `auth-provisioning-${tag}`,
    })
    .select("id")
    .single<{ id: string }>();
  if (organization.error || !organization.data) {
    throw new Error(organization.error?.message ?? "organization creation failed");
  }
  organizationId = organization.data.id;

  const anonymousEmail = `auth-public-${tag}@invalid.pixelblastermedia.com`;
  trackedEmails.push(anonymousEmail);
  const anonymous = await publicClient.auth.signUp({
    email: anonymousEmail,
    password,
  });
  if (anonymous.data.user) trackedAuthIds.push(anonymous.data.user.id);
  if (!anonymous.error || anonymous.data.user) {
    throw new Error("anonymous signup unexpectedly created an Auth user");
  }

  const invitationEmail = `auth-invite-${tag}@invalid.pixelblastermedia.com`;
  trackedEmails.push(invitationEmail);
  const invitation = await service.auth.admin.createUser({
    email: invitationEmail,
    password,
    email_confirm: true,
    app_metadata: { company_invitation_id: randomUUID() },
  });
  if (invitation.error || !invitation.data.user) {
    throw new Error(invitation.error?.message ?? "invitation user creation failed");
  }
  invitationUserId = invitation.data.user.id;
  trackedAuthIds.push(invitationUserId);
  const invitationProfile = await service
    .from("profiles")
    .select("id")
    .eq("id", invitationUserId)
    .maybeSingle();
  if (invitationProfile.error || invitationProfile.data) {
    throw new Error(
      invitationProfile.error?.message ??
        "invitation user unexpectedly received a profile",
    );
  }

  const trustedEmail = `auth-trusted-${tag}@invalid.pixelblastermedia.com`;
  trackedEmails.push(trustedEmail);
  const trusted = await service.auth.admin.createUser({
    email: trustedEmail,
    password,
    email_confirm: true,
    app_metadata: {
      realtor_organization_id: organizationId,
      realtor_provisioning_id: randomUUID(),
    },
  });
  if (trusted.error || !trusted.data.user) {
    throw new Error(trusted.error?.message ?? "trusted user creation failed");
  }
  trustedUserId = trusted.data.user.id;
  trackedAuthIds.push(trustedUserId);
  const trustedProfile = await service
    .from("profiles")
    .select("organization_id, role")
    .eq("id", trustedUserId)
    .single<{ organization_id: string; role: string }>();
  if (
    trustedProfile.error ||
    trustedProfile.data.organization_id !== organizationId ||
    trustedProfile.data.role !== "realtor"
  ) {
    throw new Error("trusted realtor landed in the wrong role or tenant");
  }

  await expectRejectedUser("auth-malformed", {
    realtor_organization_id: "not-a-uuid",
  });
  await expectRejectedUser("auth-missing-tenant", {
    realtor_organization_id: randomUUID(),
  });

} finally {
  const cleanupErrors: string[] = [];
  const ids = [...new Set(trackedAuthIds)];
  for (const id of ids) {
    const cleanup = await service.auth.admin.deleteUser(id);
    if (cleanup.error) cleanupErrors.push(cleanup.error.message);
  }
  if (organizationId) {
    const cleanup = await service
      .from("organizations")
      .delete()
      .eq("id", organizationId);
    if (cleanup.error) cleanupErrors.push(cleanup.error.message);
  }
  if (cleanupErrors.length) {
    throw new Error(`Auth canary cleanup failed: ${cleanupErrors.join("; ")}`);
  }

  for (const id of ids) {
    const lookup = await service.auth.admin.getUserById(id);
    if (lookup.error && lookup.error.status !== 404) {
      throw new Error(`Auth canary cleanup verification failed: ${lookup.error.message}`);
    }
    if (lookup.data.user) {
      throw new Error(`Auth canary user cleanup left residue: ${id}`);
    }
  }

  const trackedEmailSet = new Set(trackedEmails.map((email) => email.toLowerCase()));
  for (let page = 1; ; page += 1) {
    const listed = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (listed.error) {
      throw new Error(`Auth canary email verification failed: ${listed.error.message}`);
    }
    const matched = listed.data.users.find(
      (user) => user.email && trackedEmailSet.has(user.email.toLowerCase()),
    );
    if (matched) {
      throw new Error(`Auth canary email cleanup left residue: ${matched.email}`);
    }
    if (listed.data.users.length < 1000) break;
  }

  if (ids.length) {
    const membershipResidue = await service
      .from("organization_members")
      .select("profile_id", { count: "exact", head: true })
      .in("profile_id", ids);
    if (membershipResidue.error || (membershipResidue.count ?? 0) !== 0) {
      throw new Error("Auth canary membership cleanup left residue.");
    }
    const propertyResidue = await service
      .from("properties")
      .select("id", { count: "exact", head: true })
      .in("owner_id", ids);
    if (propertyResidue.error || (propertyResidue.count ?? 0) !== 0) {
      throw new Error("Auth canary property cleanup left residue.");
    }
    const bookingResidue = await service
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("owner_id", ids);
    if (bookingResidue.error || (bookingResidue.count ?? 0) !== 0) {
      throw new Error("Auth canary booking cleanup left residue.");
    }
    const recoveryResidue = await service
      .from("auth_recovery_grants")
      .select("jti_hash", { count: "exact", head: true })
      .in("user_id", ids);
    if (recoveryResidue.error || (recoveryResidue.count ?? 0) !== 0) {
      throw new Error("Auth canary recovery-grant cleanup left residue.");
    }
    const eventResidue = await service
      .from("provisioning_cleanup_events")
      .select("id", { count: "exact", head: true })
      .in("auth_user_id", ids);
    if (eventResidue.error || (eventResidue.count ?? 0) !== 0) {
      throw new Error("Auth canary cleanup-event residue needs reconciliation.");
    }
    const residue = await service
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .in("id", ids);
    if (residue.error || (residue.count ?? 0) !== 0) {
      throw new Error("Auth canary profile cleanup left residue.");
    }
  }
  if (organizationId) {
    const residue = await service
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .eq("id", organizationId);
    if (residue.error || (residue.count ?? 0) !== 0) {
      throw new Error("Auth canary organization cleanup left residue.");
    }
  }
}

console.log(
  JSON.stringify({
    verified: true,
    anonymousSignupRejected: true,
    invitationProfileQuarantined: true,
    trustedTenantMatched: true,
    malformedMarkerRejected: true,
    nonexistentTenantRejected: true,
    cleanupResidue: 0,
  }),
);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Auth canary failed.");
  process.exitCode = 1;
});
