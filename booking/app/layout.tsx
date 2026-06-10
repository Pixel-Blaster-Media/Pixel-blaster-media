import type { Metadata, Viewport } from "next";
import Link from "next/link";
import AuthSessionHandler from "./AuthSessionHandler";
import SiteHeaderMobileMenu, {
  type SiteNavItem,
} from "./_components/SiteHeaderMobileMenu";
import { getCurrentUser } from "@/lib/auth/current-user";
import { signOut } from "@/lib/auth/sign-out";
import {
  loadOrganizationBrand,
  organizationThemeStyle,
} from "@/lib/organizations/branding";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Pixel Blaster Booking — Real Estate Media Platform",
    template: "%s · Pixel Blaster Booking",
  },
  description:
    "Real estate media booking, delivery, listing websites, and client portals for photography companies and realtors.",
  robots: {
    // Keep the standalone booking app out of search while it lives on a
    // temporary Vercel URL. Flip this on once the public domain is ready.
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: "#0b0f10",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const brand = user ? await loadOrganizationBrand(user.organizationId) : null;
  const nav = navigationForUser(user);
  const userLabel = user ? displayNameFor(user.fullName ?? user.email) : null;

  return (
    <html lang="en">
      <body
        className="min-h-screen page-backdrop"
        style={brand ? organizationThemeStyle(brand) : undefined}
      >
        <AuthSessionHandler />
        <header className="site-header border-b border-white/5">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-4">
            <Link
              href={homeHrefForUser(user)}
              className="flex min-w-0 shrink items-center gap-2 font-semibold"
            >
              <span className="site-brand-primary text-white">
                Pixel Blaster
              </span>
              <span className="site-brand-accent text-brand-light">
                Booking
              </span>
              {userLabel ? (
                <span className="site-user-label min-w-0 truncate text-sm font-medium text-realtor-muted">
                  — {userLabel}
                </span>
              ) : null}
            </Link>
            <nav className="site-nav hidden shrink-0 items-center gap-x-4 gap-y-2 text-sm text-ink-muted md:flex md:gap-6">
              {nav.map((item) =>
                item.external ? (
                  <a
                    key={item.href}
                    href={item.href}
                    className="hover:text-white"
                  >
                    {item.label}
                  </a>
                ) : (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="hover:text-white"
                  >
                    {item.label}
                  </Link>
                ),
              )}
              {user ? (
                <form action={signOut}>
                  <button type="submit" className="hover:text-white">
                    Sign out
                  </button>
                </form>
              ) : null}
            </nav>
            <div className="relative shrink-0 md:hidden">
              <SiteHeaderMobileMenu
                label={userLabel ?? "Site"}
                items={nav}
                signOutAction={user ? signOut : undefined}
              />
            </div>
          </div>
        </header>
        <main className="site-main mx-auto max-w-6xl px-6 py-12">
          {children}
        </main>
        <footer className="site-footer mt-24 border-t border-white/5">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-6 py-8 text-xs text-ink-muted md:flex-row md:items-center">
            <p>
              © {new Date().getFullYear()} Pixel Blaster Media · Hamilton, ON ·
              Greater Toronto Area
            </p>
            <p>
              Platform beta —{" "}
              <span className="text-ink-muted/70">
                booking, delivery, and listing tools
              </span>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

function navigationForUser(
  user: Awaited<ReturnType<typeof getCurrentUser>>,
): SiteNavItem[] {
  if (user?.role === "admin") {
    return [
      { href: "/admin/today", label: "Today" },
      { href: "/admin/bookings", label: "Bookings" },
      { href: "/admin/calendar", label: "Calendar" },
      { href: "/admin/realtors", label: "Realtors" },
      { href: "/admin/settings", label: "Settings" },
    ];
  }

  if (user?.role === "realtor") {
    return [
      { href: "/portal", label: "My listings" },
      { href: "/portal/book", label: "Book" },
    ];
  }

  return [
    { href: "/start", label: "Sign up" },
    { href: "/auth/sign-in?next=/admin", label: "Sign in" },
    { href: "/book", label: "Book" },
    { href: "/portal", label: "Client Portal" },
    {
      href: "https://www.pixelblastermedia.com",
      label: "Main Site ↗",
      external: true,
    },
  ];
}

function homeHrefForUser(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  if (user?.role === "admin") return "/admin/today";
  if (user?.role === "realtor") return "/portal";
  return "/";
}

function displayNameFor(nameOrEmail: string): string {
  const clean = nameOrEmail.trim();
  if (!clean.includes("@")) return clean;
  return clean.split("@")[0]?.replace(/[._-]+/g, " ") ?? clean;
}
