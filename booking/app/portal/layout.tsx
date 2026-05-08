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
      <header className="portal-header mb-6 flex flex-wrap items-center justify-between gap-3 rounded-3xl px-3 py-2.5 md:px-4 md:py-3">
        <div className="flex items-center gap-3">
          <span className="portal-mark" aria-hidden="true">
            {initialsFor(user.fullName ?? user.email)}
          </span>
          <div>
            <p className="portal-kicker text-[11px] uppercase tracking-[0.2em]">
              Your portal
            </p>
            <p className="portal-user mt-1 text-sm font-semibold">
              {user.fullName ?? user.email}
            </p>
          </div>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link
            href="/portal"
            className="portal-nav-link portal-nav-pill rounded-full border px-3 py-1.5 transition hover:border-white/30 hover:bg-white/10 hover:text-white"
          >
            My listings
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="portal-sign-out rounded-full border px-3 py-1.5 text-xs transition hover:border-white/30 hover:bg-white/10 hover:text-white"
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

function initialsFor(nameOrEmail: string): string {
  const name = nameOrEmail.split("@")[0]?.replace(/[._-]+/g, " ") ?? "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "PB";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}
