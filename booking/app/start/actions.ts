"use server";

import { redirect } from "next/navigation";

import {
  setSupabaseSessionCookie,
  signInWithPasswordREST,
} from "@/lib/auth/set-session-cookie";
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

  const adminName = cleanText(formData.get("admin_name"));
  const adminEmail = cleanText(formData.get("admin_email")).toLowerCase();
  const adminPassword = String(formData.get("admin_password") ?? "");
  const starterSlug = starterCompanySlug(adminEmail);

  const result = await createCompanyWorkspace({
    companyName: starterCompanyName(adminName),
    slug: starterSlug,
    adminName: cleanText(formData.get("admin_name")),
    adminEmail,
    adminPassword,
    primaryColor: "#3f7f5f",
    accentColor: "#c9a35b",
    copyCatalog: true,
  });

  if (!result.ok) return result;

  const signIn = await signInWithPasswordREST(adminEmail, adminPassword);
  if (!signIn.ok) {
    return {
      ok: false,
      error:
        "Your account was created, but automatic sign-in failed. Use the sign-in page with the email and password you just created.",
    };
  }

  await setSupabaseSessionCookie(signIn.tokens, adminEmail);
  redirect("/admin/settings/business?welcome=1");
}

function starterCompanyName(adminName: string): string {
  const firstName = adminName.trim().split(/\s+/)[0];
  return firstName ? `${firstName}'s Booking System` : "New Booking System";
}

function starterCompanySlug(adminEmail: string): string {
  const localPart = adminEmail.split("@")[0] || "company";
  const base = normalizeCompanySlug(localPart).slice(0, 32) || "company";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}
