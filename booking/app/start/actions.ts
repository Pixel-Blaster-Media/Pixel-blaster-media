"use server";

import type { CompanySetupResult } from "@/lib/platform/company-setup";

export type StartCompanyResult = CompanySetupResult;

export async function startCompanySignup(
  _prev: StartCompanyResult | null,
  _formData: FormData,
): Promise<StartCompanyResult> {
  return {
    ok: false,
    error: "Company signup is currently closed. New companies require an owner invitation during beta.",
  };
}
