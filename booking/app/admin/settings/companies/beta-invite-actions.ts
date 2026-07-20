"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import {
  issueBetaCompanyInvite,
  revokeBetaCompanyInvite,
  type BetaInviteActionResult,
} from "@/lib/platform/beta-invites";
import { createCompanyWorkspaceWithInvitation } from "@/lib/platform/company-setup";
import { getServiceSupabase } from "@/lib/supabase/server";

export type IssueBetaInviteResult = BetaInviteActionResult;
export interface BetaAdminMutationResult {
  ok: boolean;
  error?: string;
  message?: string;
}

interface ReconciliationInviteRow {
  id: string;
  email: string;
  token_hash: string;
  auth_provisioning_key: string | null;
  organization_id: string | null;
  status: string;
  admin_name: string | null;
  company_name: string | null;
  company_slug: string | null;
  primary_color: string | null;
  accent_color: string | null;
  copy_catalog: boolean | null;
  source_catalog_organization_id: string | null;
}

export async function issueBetaInvite(
  _previous: IssueBetaInviteResult | null,
  formData: FormData,
): Promise<IssueBetaInviteResult> {
  const platformAdmin = await requirePlatformAdmin();
  if (process.env.BETA_COMPANY_ONBOARDING_ENABLED !== "true") {
    return { ok: false, error: "Private beta invitations are temporarily disabled." };
  }
  const result = await issueBetaCompanyInvite({
    email: String(formData.get("email") ?? ""),
    actorId: platformAdmin.userId,
  });
  if (result.ok) revalidatePath("/admin/settings/companies");
  return result;
}

export async function revokeBetaInvite(
  _previous: BetaAdminMutationResult | null,
  formData: FormData,
): Promise<BetaAdminMutationResult> {
  const platformAdmin = await requirePlatformAdmin();
  const result = await revokeBetaCompanyInvite({
    inviteId: String(formData.get("invite_id") ?? ""),
    actorId: platformAdmin.userId,
  });
  if (!result.ok) return { ok: false, error: result.error ?? "Revocation failed." };
  revalidatePath("/admin/settings/companies");
  return { ok: true, message: "Invitation revoked." };
}

export async function activateBetaCompany(
  _previous: BetaAdminMutationResult | null,
  formData: FormData,
): Promise<BetaAdminMutationResult> {
  const platformAdmin = await requirePlatformAdmin();
  const organizationId = String(formData.get("organization_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) {
    return { ok: false, error: "Invalid company." };
  }
  const service = getServiceSupabase();
  const { data, error } = await service.rpc("activate_beta_company", {
    p_organization_id: organizationId,
    p_actor_id: platformAdmin.userId,
  });
  if (error || data !== true) {
    return { ok: false, error: "The company could not be activated. Reconcile it first." };
  }
  revalidatePath("/admin/settings/companies");
  return { ok: true, message: "Company booking link activated." };
}

export async function reconcileBetaCompany(
  _previous: BetaAdminMutationResult | null,
  formData: FormData,
): Promise<BetaAdminMutationResult> {
  const platformAdmin = await requirePlatformAdmin();
  const inviteId = String(formData.get("invite_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(inviteId)) {
    return { ok: false, error: "Invalid invitation." };
  }

  const service = getServiceSupabase();
  const { data: invite, error: loadError } = await service
    .from("beta_company_invites")
    .select("id, email, token_hash, auth_provisioning_key, organization_id, status, admin_name, company_name, company_slug, primary_color, accent_color, copy_catalog, source_catalog_organization_id")
    .eq("id", inviteId)
    .maybeSingle<ReconciliationInviteRow>();
  if (loadError || !invite || !hasReconciliationInputs(invite)) {
    return { ok: false, error: "The provisioning state could not be loaded safely." };
  }

  const { data: resumed, error: resumeError } = await service.rpc(
    "resume_beta_company_onboarding",
    { p_invite_id: invite.id, p_actor_id: platformAdmin.userId },
  );
  if (resumeError || resumed !== true) {
    return { ok: false, error: "This invitation is not eligible for reconciliation." };
  }

  const setup = await createCompanyWorkspaceWithInvitation({
    companyName: invite.company_name,
    slug: invite.company_slug,
    adminName: invite.admin_name,
    adminEmail: invite.email,
    primaryColor: invite.primary_color,
    accentColor: invite.accent_color,
    copyCatalog: invite.copy_catalog,
    sourceCatalogOrganizationId: invite.source_catalog_organization_id,
    invitationId: invite.id,
    organizationId: invite.organization_id,
    authProvisioningKey: invite.auth_provisioning_key,
  });
  if (!setup.ok) {
    return {
      ok: false,
      error: "Reconciliation did not complete. Retry using the same invitation.",
    };
  }

  const { data: authUserId, error: authLookupError } = await service.rpc(
    "find_company_invitation_auth_user",
    { p_invitation_id: invite.id },
  );
  if (authLookupError || typeof authUserId !== "string") {
    return { ok: false, error: "Owner identity recovery remains unresolved. Retry reconciliation." };
  }
  const { data: completed, error: completeError } = await service.rpc(
    "complete_beta_company_onboarding",
    { p_token_hash: invite.token_hash, p_auth_user_id: authUserId },
  );
  if (completeError || completed !== true) {
    return { ok: false, error: "Company ownership could not be finalized. Retry reconciliation." };
  }

  revalidatePath("/admin/settings/companies");
  return { ok: true, message: "Company provisioning reconciled. Review it before activation." };
}

function hasReconciliationInputs(
  invite: ReconciliationInviteRow,
): invite is ReconciliationInviteRow & {
  organization_id: string;
  auth_provisioning_key: string;
  admin_name: string;
  company_name: string;
  company_slug: string;
  primary_color: string;
  accent_color: string;
  copy_catalog: boolean;
  source_catalog_organization_id: string;
} {
  return (
    ["provisioning", "reconciliation_required"].includes(invite.status) &&
    typeof invite.organization_id === "string" &&
    typeof invite.auth_provisioning_key === "string" &&
    /^[0-9a-f]{64}$/.test(invite.auth_provisioning_key) &&
    typeof invite.admin_name === "string" &&
    typeof invite.company_name === "string" &&
    typeof invite.company_slug === "string" &&
    typeof invite.primary_color === "string" &&
    typeof invite.accent_color === "string" &&
    typeof invite.copy_catalog === "boolean" &&
    typeof invite.source_catalog_organization_id === "string"
  );
}
