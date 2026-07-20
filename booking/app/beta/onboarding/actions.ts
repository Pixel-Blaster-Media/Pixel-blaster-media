"use server";

import { cookies } from "next/headers";

import {
  cleanText,
  createCompanyWorkspaceWithInvitation,
  normalizeCompanySlug,
} from "@/lib/platform/company-setup";
import {
  BETA_INVITE_COOKIE,
  getActiveBetaCompanyInvite,
} from "@/lib/platform/beta-invites";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";
import { getServiceSupabase } from "@/lib/supabase/server";

export interface BetaCompanySetupResult {
  ok: boolean;
  error?: string;
  warning?: string;
  companyName?: string;
  bookingPath?: string;
  invitationSent?: boolean;
}

interface BeginOnboardingResult {
  invitation_id: string;
  organization_id: string;
  email: string;
  auth_provisioning_key: string;
  state: "started" | "resumed";
}

export async function acceptBetaCompanyInvite(
  _previous: BetaCompanySetupResult | null,
  formData: FormData,
): Promise<BetaCompanySetupResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get(BETA_INVITE_COOKIE)?.value ?? "";
  const invite = await getActiveBetaCompanyInvite(token);
  if (!invite) {
    return {
      ok: false,
      error: "This beta invitation is invalid, expired, used, or revoked.",
    };
  }

  const companyName = cleanText(formData.get("company_name"));
  const slug = normalizeCompanySlug(cleanText(formData.get("slug")));
  const adminName = cleanText(formData.get("admin_name"));
  const primaryColor = cleanText(formData.get("primary_color")) || "#3f7f5f";
  const accentColor = cleanText(formData.get("accent_color")) || "#c9a35b";
  const copyCatalog = formData.get("copy_catalog") === "on";
  const service = getServiceSupabase();
  const { data: beginData, error: beginError } = await service.rpc(
    "begin_beta_company_onboarding",
    {
      p_token_hash: invite.tokenHash,
      p_admin_name: adminName,
      p_company_name: companyName,
      p_company_slug: slug,
      p_primary_color: primaryColor,
      p_accent_color: accentColor,
      p_copy_catalog: copyCatalog,
      p_source_catalog_organization_id: DEFAULT_ORGANIZATION_ID,
    },
  );
  const begin = parseBeginResult(beginData);
  if (
    beginError ||
    !begin ||
    begin.invitation_id !== invite.id ||
    begin.email !== invite.email
  ) {
    return {
      ok: false,
      error: `Company setup could not start safely. Retry the same details or contact support (reference ${invite.id.slice(0, 8)}).`,
    };
  }

  const result = await createCompanyWorkspaceWithInvitation({
    companyName,
    slug,
    adminName,
    adminEmail: invite.email,
    primaryColor,
    accentColor,
    copyCatalog,
    sourceCatalogOrganizationId: DEFAULT_ORGANIZATION_ID,
    invitationId: invite.id,
    organizationId: begin.organization_id,
    authProvisioningKey: begin.auth_provisioning_key,
  });
  if (!result.ok || !result.slug) return result;

  const { data: authUserId, error: authLookupError } = await service.rpc(
    "find_company_invitation_auth_user",
    { p_invitation_id: invite.id },
  );
  if (authLookupError || typeof authUserId !== "string") {
    return {
      ok: false,
      error: `The workspace was provisioned, but owner verification needs support (reference ${invite.id.slice(0, 8)}). Do not resubmit different company details.`,
    };
  }

  const { data: completed, error: completeError } = await service.rpc(
    "complete_beta_company_onboarding",
    { p_token_hash: invite.tokenHash, p_auth_user_id: authUserId },
  );
  if (completeError || completed !== true) {
    return {
      ok: false,
      error: `The workspace was provisioned, but final confirmation needs support (reference ${invite.id.slice(0, 8)}). Check the owner invitation email and do not resubmit different details.`,
    };
  }

  cookieStore.set(BETA_INVITE_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/beta",
    maxAge: 0,
  });
  return {
    ok: true,
    companyName: result.companyName,
    bookingPath: result.bookingPath,
    invitationSent: result.invitationSent,
    warning: result.warning,
  };
}

function parseBeginResult(value: unknown): BeginOnboardingResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.invitation_id !== "string" ||
    typeof row.organization_id !== "string" ||
    typeof row.email !== "string" ||
    typeof row.auth_provisioning_key !== "string" ||
    !/^[0-9a-f]{64}$/.test(row.auth_provisioning_key) ||
    (row.state !== "started" && row.state !== "resumed")
  ) {
    return null;
  }
  return row as unknown as BeginOnboardingResult;
}
