import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/lib/auth/sign-out";
import { requireUser } from "@/lib/auth/require-user";

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

  return (
    <div className="min-h-[60vh]">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-brand-light">
            Your portal
          </p>
          <p className="text-sm text-white">
            {user.fullName ?? user.email}
          </p>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link
            href="/portal"
            className="text-ink-muted transition hover:text-white"
          >
            My listings
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-ink-muted hover:border-white/30 hover:text-white"
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
