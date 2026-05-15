"use server";

import {
  cleanText,
  createCompanyWorkspace,
  normalizeCompanySlug,
  type CompanySetupResult,
} from "@/lib/platform/company-setup";

export type StartCompanyResult = CompanySetupResult;

export async function startCompanySignup(
  _prev: StartCompanyResult | null,
  formData: FormData,
): Promise<StartCompanyResult> {
  if (cleanText(formData.get("website"))) {
    return { ok: false, error: "Could not create this account." };
  }

  return createCompanyWorkspace({
    companyName: cleanText(formData.get("company_name")),
    slug: normalizeCompanySlug(cleanText(formData.get("slug"))),
    adminName: cleanText(formData.get("admin_name")),
    adminEmail: cleanText(formData.get("admin_email")).toLowerCase(),
    adminPassword: String(formData.get("admin_password") ?? ""),
    primaryColor: cleanText(formData.get("primary_color")) || "#3f7f5f",
    accentColor: cleanText(formData.get("accent_color")) || "#c9a35b",
    copyCatalog: true,
  });
}
