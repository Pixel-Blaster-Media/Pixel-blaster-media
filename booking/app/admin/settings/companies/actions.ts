"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import {
  cleanText,
  createCompanyWorkspaceWithInvitation,
  normalizeCompanySlug,
  type CompanySetupResult,
} from "@/lib/platform/company-setup";

export type CreateCompanyResult = CompanySetupResult;

export async function createCompany(
  _prev: CreateCompanyResult | null,
  formData: FormData,
): Promise<CreateCompanyResult> {
  const platformAdmin = await requirePlatformAdmin();
  const result = await createCompanyWorkspaceWithInvitation({
    companyName: cleanText(formData.get("company_name")),
    slug: normalizeCompanySlug(cleanText(formData.get("slug"))),
    adminName: cleanText(formData.get("admin_name")),
    adminEmail: cleanText(formData.get("admin_email")).toLowerCase(),
    primaryColor: cleanText(formData.get("primary_color")) || "#3f7f5f",
    accentColor: cleanText(formData.get("accent_color")) || "#c9a35b",
    copyCatalog: formData.get("copy_catalog") === "on",
    sourceCatalogOrganizationId: platformAdmin.organizationId,
  });

  if (result.ok) {
    revalidatePath("/admin/settings");
    revalidatePath("/admin/settings/companies");
  }

  return result;
}
