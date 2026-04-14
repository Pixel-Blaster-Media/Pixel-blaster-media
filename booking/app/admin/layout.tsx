import Link from "next/link";

import { signOut } from "@/lib/auth/sign-out";
import { requireAdmin } from "@/lib/auth/require-admin";

const NAV = [
  { href: "/admin/inbox", label: "Inbox" },
  { href: "/admin/bookings", label: "Bookings" },
] as const;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  return (
    <div className="grid min-h-[60vh] gap-8 md:grid-cols-[200px_1fr]">
      <aside className="space-y-4 md:sticky md:top-16 md:self-start">
        <div className="rounded-lg border border-white/10 bg-ink-soft/60 p-4 text-sm">
          <p className="text-[11px] uppercase tracking-wider text-ink-muted">
            Signed in
          </p>
          <p className="mt-1 truncate text-white">{admin.fullName ?? admin.email}</p>
          <p className="truncate text-xs text-ink-muted">{admin.email}</p>
        </div>
        <nav className="flex flex-col gap-1 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-ink-muted hover:bg-white/5 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
          <form action={signOut}>
            <button
              type="submit"
              className="mt-2 w-full rounded-md border border-white/10 px-3 py-2 text-left text-xs text-ink-muted hover:border-white/30 hover:text-white"
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
