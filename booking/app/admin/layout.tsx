import Link from "next/link";

import { signOut } from "@/lib/auth/sign-out";
import { requireAdmin } from "@/lib/auth/require-admin";

import AdminAssistant from "./AdminAssistant";

const NAV = [
  { href: "/admin/today", label: "Today" },
  { href: "/admin/inbox", label: "Inbox" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/realtors", label: "Realtors" },
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
    <div className="admin-earth realtor-theme realtor-backdrop grid min-h-screen w-full overflow-x-hidden px-4 py-4 sm:px-6 md:grid-cols-[220px_1fr] md:gap-8 md:px-6 md:py-10">
      <div className="md:hidden">
        <details className="rounded-2xl border border-white/10 bg-ink-soft/80 p-3 shadow-lg shadow-black/10">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-1 py-1 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
            <span>
              Admin menu
              <span className="mt-0.5 block max-w-[220px] truncate text-xs font-normal text-ink-muted">
                {admin.fullName ?? admin.email}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 flex-col items-center justify-center gap-1 rounded-full border border-white/10 bg-white/5"
            >
              <span className="h-0.5 w-4 rounded-full bg-current" />
              <span className="h-0.5 w-4 rounded-full bg-current" />
              <span className="h-0.5 w-4 rounded-full bg-current" />
            </span>
          </summary>
          <nav className="mt-3 grid gap-1 border-t border-white/10 pt-3 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-xl px-3 py-2 text-ink-muted transition hover:bg-white/7 hover:text-white"
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
        </details>
      </div>

      <aside className="hidden space-y-4 md:sticky md:top-16 md:block md:self-start">
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
      <section className="space-y-6">
        <AdminAssistant />
        {children}
      </section>
    </div>
  );
}
