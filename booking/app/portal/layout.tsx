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
    <div className="portal-layout realtor-theme min-h-[60vh]">
      <header className="portal-header realtor-elevated-panel mb-10 flex flex-wrap items-center justify-between gap-3 rounded-3xl p-4 md:p-5">
        <div>
          <p className="portal-kicker text-[11px] uppercase tracking-[0.2em] text-realtor-primary">
            Your portal
          </p>
          <p className="portal-user mt-1 text-sm font-semibold text-realtor-text">
            {user.fullName ?? user.email}
          </p>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link
            href="/portal"
            className="portal-nav-link rounded-full px-3 py-1.5 text-realtor-muted transition hover:bg-realtor-primary/10 hover:text-realtor-text"
          >
            My listings
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="portal-sign-out rounded-full border border-realtor-primary/20 px-3 py-1.5 text-xs text-realtor-muted transition hover:border-realtor-primary/35 hover:bg-realtor-surface hover:text-realtor-text"
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
