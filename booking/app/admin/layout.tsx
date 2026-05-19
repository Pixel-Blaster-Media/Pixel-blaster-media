import Link from "next/link";

import { signOut } from "@/lib/auth/sign-out";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  initialsForOrganization,
  loadOrganizationBrand,
  organizationThemeStyle,
} from "@/lib/organizations/branding";

import AdminAssistant from "./AdminAssistant";
import AdminMobileMenu from "./AdminMobileMenu";

const NAV = [
  { href: "/admin/today", label: "Today" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/calendar", label: "Calendar" },
  { href: "/admin/realtors", label: "Realtors" },
  { href: "/admin/settings", label: "Settings" },
] as const;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();
  const brand = await loadOrganizationBrand(admin.organizationId);

  return (
    <div
      className="admin-earth realtor-theme realtor-backdrop grid min-h-screen w-full max-w-full overflow-x-hidden px-3 pb-32 sm:px-6 md:grid-cols-[220px_1fr] md:gap-8 md:px-6 md:py-10"
      style={{
        ...(brand ? organizationThemeStyle(brand) : {}),
        paddingTop: "max(1rem, calc(env(safe-area-inset-top, 0px) + 0.75rem))",
      }}
    >
      <div className="md:hidden">
        <AdminMobileMenu
          adminLabel={admin.fullName ?? admin.email}
          nav={NAV}
          signOutAction={signOut}
        />
      </div>

      <aside className="hidden space-y-4 md:sticky md:top-16 md:block md:self-start">
        <div className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-4 text-sm shadow-lg shadow-realtor-text/10">
          {brand ? (
            <div className="mb-4 flex items-center gap-3 rounded-xl bg-realtor-primary/5 p-2 ring-1 ring-realtor-primary/10">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-realtor-primary/10 text-xs font-bold text-realtor-primary">
                {brand.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brand.logoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  initialsForOrganization(brand.name)
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-realtor-text">
                  {brand.name}
                </p>
                <p className="truncate text-[11px] text-realtor-muted">
                  /book?org={brand.slug}
                </p>
              </div>
            </div>
          ) : null}
          <p className="text-[11px] uppercase tracking-wider text-realtor-primary/80">
            Signed in
          </p>
          <p className="mt-1 truncate text-realtor-text">
            {admin.fullName ?? admin.email}
          </p>
          <p className="truncate text-xs text-realtor-muted">{admin.email}</p>
        </div>
        <nav className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/70 p-2 text-sm shadow-sm shadow-realtor-text/5">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-xl px-3 py-2 text-realtor-muted transition hover:bg-realtor-primary/10 hover:text-realtor-primary"
            >
              {item.label}
            </Link>
          ))}
          <form action={signOut}>
            <button
              type="submit"
              className="mt-2 w-full rounded-xl border border-realtor-primary/15 px-3 py-2 text-left text-xs text-realtor-muted transition hover:border-realtor-primary/30 hover:bg-realtor-primary/5 hover:text-realtor-primary"
            >
              Sign out
            </button>
          </form>
        </nav>
      </aside>
      <section className="min-w-0 max-w-full space-y-6 overflow-hidden">
        <AdminAssistant />
        {children}
      </section>
    </div>
  );
}
