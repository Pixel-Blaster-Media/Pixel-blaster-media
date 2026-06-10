import type { Viewport } from "next";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/require-user";
import {
  loadOrganizationBrand,
  organizationThemeStyle,
} from "@/lib/organizations/branding";

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#fbfcfa",
};

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser("/portal");

  // Admins have their own view — bounce them there rather than showing
  // an empty property list (admins don't own properties).
  if (user.role === "admin") {
    redirect("/admin");
  }
  const brand = await loadOrganizationBrand(user.organizationId);

  return (
    <div
      className="portal-layout realtor-theme min-h-[60vh]"
      style={brand ? organizationThemeStyle(brand) : undefined}
    >
      {children}
    </div>
  );
}
