import Link from "next/link";

import { signOut } from "@/lib/auth/sign-out";
import { requireAdmin } from "@/lib/auth/require-admin";

const NAV = [
  { href: "/admin/today", label: "Today" },
  { href: "/admin/inbox", label: "Inbox" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/iguide", label: "iGUIDE Review" },
  { href: "/admin/calendar", label: "Calendar" },
  { href: "/admin/settings/availability", label: "Availability" },
  { href: "/admin/settings/pricing", label: "Pricing" },
  { href: "/admin/settings/integrations", label: "Integrations" },
] as const;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  return (
    <div className="admin-earth realtor-theme realtor-backdrop -mx-6 -my-12 grid min-h-screen gap-8 px-6 py-8 md:grid-cols-[220px_1fr] md:py-10">
      <aside className="space-y-4 md:sticky md:top-16 md:self-start">
        <div className="rounded-2xl border border-white/10 bg-ink-soft/70 p-4 text-sm shadow-lg shadow-black/10">
          <p className="text-[11px] uppercase tracking-wider text-brand-light/80">
            Signed in
          </p>
          <p className="mt-1 truncate text-white">{admin.fullName ?? admin.email}</p>
          <p className="truncate text-xs text-ink-muted">{admin.email}</p>
        </div>
        <nav className="rounded-2xl border border-white/10 bg-ink-soft/45 p-2 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-xl px-3 py-2 text-ink-muted transition hover:bg-white/7 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
          <form action={signOut}>
            <button
              type="submit"
              className="mt-2 w-full rounded-xl border border-white/10 px-3 py-2 text-left text-xs text-ink-muted transition hover:border-white/30 hover:bg-white/5 hover:text-white"
            >
              Sign out
            </button>
          </form>
        </nav>
      </aside>
      <section>{children}</section>
    </div>
  );
}
