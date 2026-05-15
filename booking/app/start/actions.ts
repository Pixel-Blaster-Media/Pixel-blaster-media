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
  const expectedCode = process.env.SAAS_SIGNUP_INVITE_CODE?.trim();
  if (!expectedCode) {
    return {
      ok: false,
      error:
        "Self-serve signup is not enabled yet. Ask Pixel Blaster for an invite.",
    };
  }

  const inviteCode = cleanText(formData.get("invite_code"));
  if (inviteCode !== expectedCode) {
    return { ok: false, error: "That invite code does not look right." };
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
