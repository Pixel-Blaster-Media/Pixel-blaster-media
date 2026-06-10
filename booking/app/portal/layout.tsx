import Link from "next/link";
import type { Viewport } from "next";
import { redirect } from "next/navigation";

import { signOut } from "@/lib/auth/sign-out";
import { requireUser } from "@/lib/auth/require-user";
import {
  loadOrganizationBrand,
  organizationThemeStyle,
} from "@/lib/organizations/branding";
import { getServerSupabase } from "@/lib/supabase/server";

interface ProfilePhotoRow {
  profile_photo_url: string | null;
}

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
  const profilePhotoUrl = await loadProfilePhotoUrl(user.userId);
  const brand = await loadOrganizationBrand(user.organizationId);

  return (
    <div
      className="portal-layout realtor-theme min-h-[60vh]"
      style={brand ? organizationThemeStyle(brand) : undefined}
    >
      <header className="portal-header mb-6 flex flex-wrap items-center justify-between gap-3 rounded-3xl px-3 py-2.5 md:px-4 md:py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="portal-mark" aria-hidden="true">
            {profilePhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profilePhotoUrl} alt="" />
            ) : (
              initialsFor(user.fullName ?? user.email)
            )}
          </span>
          <div className="min-w-0">
            <p className="portal-kicker text-[11px] uppercase tracking-[0.2em]">
              Your portal
            </p>
            <p className="portal-user mt-1 truncate text-sm font-semibold">
              {user.fullName ?? user.email}
            </p>
          </div>
        </div>
        <nav className="flex shrink-0 items-center gap-3 text-sm">
          <Link
            href="/portal"
            className="tap-target portal-nav-link portal-nav-pill rounded-full border px-3 py-1.5 transition hover:border-white/30 hover:bg-white/10 hover:text-white"
          >
            My listings
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="tap-target portal-sign-out rounded-full border px-3 py-1.5 text-xs transition hover:border-white/30 hover:bg-white/10 hover:text-white"
            >
              Sign out
            </button>
          </form>
        </nav>
      </header>
      {children}
    </div>
  );
}

async function loadProfilePhotoUrl(userId: string): Promise<string | null> {
  try {
    const supabase = await getServerSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .select("profile_photo_url")
      .eq("id", userId)
      .maybeSingle<ProfilePhotoRow>();
    if (error) return null;
    return data?.profile_photo_url ?? null;
  } catch {
    return null;
  }
}

function initialsFor(nameOrEmail: string): string {
  const name = nameOrEmail.split("@")[0]?.replace(/[._-]+/g, " ") ?? "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "PB";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}
