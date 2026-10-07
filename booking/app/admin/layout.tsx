import type { Viewport } from "next";

import { requireAdmin } from "@/lib/auth/require-admin";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";
import {
  loadOrganizationBrand,
  organizationThemeStyle,
} from "@/lib/organizations/branding";

import AdminAssistant from "./AdminAssistant";
import AdminWorkspace from "./AdminWorkspace";
import { signOut } from "@/lib/auth/sign-out";
import "./studio-workspace.css";

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#fbfcfa",
  viewportFit: "cover",
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
      className="pixel-app-skin studio-workspace admin-earth realtor-theme realtor-backdrop"
      data-pixel-default-palette={admin.organizationId === DEFAULT_ORGANIZATION_ID ? true : undefined}
      style={{
        ...(brand ? organizationThemeStyle(brand) : {}),
      }}
    >
      <AdminWorkspace name={brand?.name ?? "Studio workspace"} logoUrl={brand?.logoUrl ?? null} signOutAction={signOut}>
        <AdminAssistant />
        {children}
      </AdminWorkspace>
    </div>
  );
}
