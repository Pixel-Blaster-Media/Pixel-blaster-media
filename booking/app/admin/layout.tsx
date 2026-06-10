import type { Viewport } from "next";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  loadOrganizationBrand,
  organizationThemeStyle,
} from "@/lib/organizations/branding";

import AdminAssistant from "./AdminAssistant";

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#fbfcfa",
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();
  const brand = await loadOrganizationBrand(admin.organizationId);

  return (
    <div
      className="admin-earth realtor-theme realtor-backdrop min-h-screen w-full max-w-full overflow-x-hidden px-3 pb-32 sm:px-6 md:px-4 lg:px-6"
      style={{
        ...(brand ? organizationThemeStyle(brand) : {}),
      }}
    >
      <section className="mx-auto min-w-0 max-w-6xl space-y-6 overflow-hidden py-4 md:py-6">
        <AdminAssistant />
        {children}
      </section>
    </div>
  );
}
