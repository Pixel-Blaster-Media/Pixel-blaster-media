import { randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";
import { getServiceSupabase } from "@/lib/supabase/server";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error("Supabase public configuration missing");

const service = getServiceSupabase();
const marker = Date.now();
const organizationSlug = `tenant-hardening-${marker}`;
const adminEmail = `${organizationSlug}-admin@invalid.pixelblastermedia.com`;
const realtorEmail = `${organizationSlug}-realtor@invalid.pixelblastermedia.com`;
const foreignEmail = `${organizationSlug}-foreign@invalid.pixelblastermedia.com`;
const password = `Canary-${randomBytes(24).toString("base64url")}!7aA`;

let organizationId: string | null = null;
let adminId: string | null = null;
let realtorId: string | null = null;
let foreignId: string | null = null;

function authenticatedClient() {
  return createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function createUser(
  email: string,
  appMetadata: Record<string, string>,
) {
  const result = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: appMetadata,
  });
  if (result.error || !result.data.user) {
    throw new Error(result.error?.message ?? "user creation failed");
  }
  return result.data.user.id;
}

async function main() {
  const cleanupErrors: string[] = [];
  try {
    const organization = await service
      .from("organizations")
      .insert({
        name: `[CANARY DELETE] Tenant hardening ${marker}`,
        slug: organizationSlug,
        primary_color: "#3f7f5f",
        accent_color: "#c9a35b",
        invoice_timing: "on_delivery",
      })
      .select("id")
      .single<{ id: string }>();
    if (organization.error || !organization.data) {
      throw new Error(organization.error?.message ?? "organization creation failed");
    }
    organizationId = organization.data.id;

    adminId = await createUser(adminEmail, {
      company_invitation_id: randomUUID(),
    });
    const adminProfile = await service
      .from("profiles")
      .upsert({
        id: adminId,
        email: adminEmail,
        organization_id: organizationId,
        role: "admin",
      });
    if (adminProfile.error) throw new Error(adminProfile.error.message);

    realtorId = await createUser(realtorEmail, {
      realtor_organization_id: organizationId,
      realtor_provisioning_id: randomUUID(),
    });
    const realtorProfile = await service
      .from("profiles")
      .upsert({
        id: realtorId,
        email: realtorEmail,
        organization_id: organizationId,
        role: "realtor",
      });
    if (realtorProfile.error) throw new Error(realtorProfile.error.message);

    foreignId = await createUser(foreignEmail, {
      realtor_organization_id: DEFAULT_ORGANIZATION_ID,
    });

    const adminClient = authenticatedClient();
    const adminSignIn = await adminClient.auth.signInWithPassword({
      email: adminEmail,
      password,
    });
    if (adminSignIn.error) throw new Error(adminSignIn.error.message);

    const visibleOrganizations = await adminClient
      .from("organizations")
      .select("id");
    if (visibleOrganizations.error) throw new Error(visibleOrganizations.error.message);
    if (
      visibleOrganizations.data?.length !== 1 ||
      visibleOrganizations.data[0].id !== organizationId
    ) {
      throw new Error("tenant admin can see organizations outside its membership");
    }

    const serviceProtectedCounts = await Promise.all([
      service
        .from("google_calendar_connection")
        .select("id", { count: "exact", head: true }),
      service
        .from("booking_notifications")
        .select("id", { count: "exact", head: true }),
      service
        .from("integration_credentials")
        .select("organization_id", { count: "exact", head: true }),
    ]);
    if (serviceProtectedCounts.some((result) => result.error)) {
      throw new Error("protected-table service-role baseline is unavailable");
    }

    const browserProtectedReads = await Promise.all([
      adminClient.from("google_calendar_connection").select("id"),
      adminClient.from("booking_notifications").select("id"),
      adminClient.from("integration_credentials").select("organization_id"),
      adminClient.from("quickbooks_connection").select("id"),
    ]);
    if (
      browserProtectedReads.some(
        (result) => result.error || (result.data ?? []).length !== 0,
      )
    ) {
      throw new Error("tenant admin directly read a protected integration table");
    }

    const membershipInForeignOrganization = await adminClient
      .from("organization_members")
      .insert({
        organization_id: DEFAULT_ORGANIZATION_ID,
        profile_id: adminId,
        role: "owner",
      });
    if (!membershipInForeignOrganization.error) {
      throw new Error("tenant admin joined a foreign organization");
    }

    const foreignProfileInOwnOrganization = await adminClient
      .from("organization_members")
      .insert({
        organization_id: organizationId,
        profile_id: foreignId,
        role: "owner",
      });
    if (!foreignProfileInOwnOrganization.error) {
      throw new Error("tenant admin imported a foreign profile into its organization");
    }

    const peerAuthorizationChange = await adminClient
      .from("profiles")
      .update({ email: `${organizationSlug}-spoofed@invalid.pixelblastermedia.com` })
      .eq("id", realtorId)
      .select("id");
    if (!peerAuthorizationChange.error) {
      throw new Error("tenant admin changed another profile's authorization email");
    }

    const realtorClient = authenticatedClient();
    const realtorSignIn = await realtorClient.auth.signInWithPassword({
      email: realtorEmail,
      password,
    });
    if (realtorSignIn.error) throw new Error(realtorSignIn.error.message);

    const selfPromotion = await realtorClient
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", realtorId);
    if (!selfPromotion.error) {
      throw new Error("realtor self-promotion unexpectedly succeeded");
    }

    const persistedProfile = await service
      .from("profiles")
      .select("role, email")
      .eq("id", realtorId)
      .single<{ role: string; email: string }>();
    if (
      persistedProfile.error ||
      persistedProfile.data?.role !== "realtor" ||
      persistedProfile.data?.email !== realtorEmail
    ) {
      throw new Error("rejected profile authorization changes were persisted");
    }

    const archivedAt = new Date().toISOString();
    const archiveAdmin = await service
      .from("profiles")
      .update({ archived_at: archivedAt })
      .eq("id", adminId);
    if (archiveAdmin.error) throw new Error(archiveAdmin.error.message);

    const archivedAdminVisibility = await adminClient
      .from("organizations")
      .select("id");
    if (archivedAdminVisibility.error) {
      throw new Error(archivedAdminVisibility.error.message);
    }
    if ((archivedAdminVisibility.data ?? []).length !== 0) {
      throw new Error("archived administrator retained organization RLS access");
    }

    // Success is reported only after cleanup and residue verification below.
  } finally {
    if (adminId) {
      const membershipCleanup = await service
        .from("organization_members")
        .delete()
        .eq("profile_id", adminId);
      if (membershipCleanup.error) {
        cleanupErrors.push(`membership: ${membershipCleanup.error.message}`);
      }
    }
    if (foreignId) {
      const foreignCleanup = await service.auth.admin.deleteUser(foreignId);
      if (foreignCleanup.error) {
        cleanupErrors.push(`foreign: ${foreignCleanup.error.message}`);
      }
    }
    if (realtorId) {
      const realtorCleanup = await service.auth.admin.deleteUser(realtorId);
      if (realtorCleanup.error) {
        cleanupErrors.push(`realtor: ${realtorCleanup.error.message}`);
      }
    }
    if (adminId) {
      const adminCleanup = await service.auth.admin.deleteUser(adminId);
      if (adminCleanup.error) {
        cleanupErrors.push(`admin: ${adminCleanup.error.message}`);
      }
    }
    if (organizationId) {
      const organizationCleanup = await service
        .from("organizations")
        .delete()
        .eq("id", organizationId);
      if (organizationCleanup.error) {
        cleanupErrors.push(`organization: ${organizationCleanup.error.message}`);
      }
    }
    const authResidueIds = [adminId, realtorId, foreignId].filter(
      (id): id is string => Boolean(id),
    );
    for (const id of authResidueIds) {
      const lookup = await service.auth.admin.getUserById(id);
      if (lookup.data.user) cleanupErrors.push(`auth user residue: ${id}`);
      if (lookup.error && lookup.error.status !== 404) {
        cleanupErrors.push(`auth residue lookup failed: ${lookup.error.message}`);
      }
    }

    const membershipResidue = authResidueIds.length
      ? await service
          .from("organization_members")
          .select("organization_id", { count: "exact", head: true })
          .in("profile_id", authResidueIds)
      : { count: 0, error: null };

    const [organizationResidue, profileResidue] = await Promise.all([
      service
        .from("organizations")
        .select("id", { count: "exact", head: true })
        .eq("slug", organizationSlug),
      service
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .in("email", [adminEmail, realtorEmail, foreignEmail]),
    ]);
    if (
      organizationResidue.error ||
      profileResidue.error ||
      membershipResidue.error
    ) {
      cleanupErrors.push("residue verification query failed");
    } else {
      const residue =
        (organizationResidue.count ?? 0) +
        (profileResidue.count ?? 0) +
        (membershipResidue.count ?? 0);
      if (residue !== 0) cleanupErrors.push(`residue: ${residue} rows`);
    }
    if (cleanupErrors.length) {
      throw new Error(`canary cleanup failed: ${cleanupErrors.join("; ")}`);
    }
  }

  console.log(
    JSON.stringify({
      verified: true,
      selfPromotionBlocked: true,
      crossTenantMembershipBlocked: true,
      peerAuthorizationChangeBlocked: true,
      archivedAdminBlocked: true,
      protectedTableBrowserReadsBlocked: true,
      organizationIsolation: true,
      residue: 0,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "verification failed");
  process.exitCode = 1;
});
