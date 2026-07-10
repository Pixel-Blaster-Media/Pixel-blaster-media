"use client";

import { ChevronDown, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export type SiteNavItem = {
  href: string;
  label: string;
  external?: boolean;
};

export default function SiteHeaderMobileMenu({
  label,
  items,
  signOutAction,
  avatarUrl,
}: {
  label: string;
  items: readonly SiteNavItem[];
  signOutAction?: () => void | Promise<void>;
  avatarUrl?: string | null;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (detailsRef.current) {
      detailsRef.current.open = false;
    }
  }, [pathname]);

  return (
    <details ref={detailsRef} className="site-mobile-menu md:hidden">
      <summary
        className="flex h-10 cursor-pointer list-none items-center gap-1 rounded-full border border-realtor-primary/15 bg-white/85 p-1 pr-2 text-realtor-primary shadow-sm shadow-realtor-text/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-realtor-primary/60 [&::-webkit-details-marker]:hidden"
        aria-label={`${label} menu`}
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-realtor-primary/10 bg-cover bg-center text-xs font-bold text-realtor-primary"
          style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
        >
          {!avatarUrl ? <UserRound className="h-4 w-4" /> : null}
        </span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
      </summary>
      <nav className="absolute right-0 top-11 z-50 w-56 rounded-2xl border border-realtor-primary/15 bg-white/95 p-2 text-sm shadow-xl shadow-realtor-text/15 backdrop-blur">
        {items.map((item) =>
          item.external ? (
            <a
              key={item.href}
              href={item.href}
              className="block rounded-xl px-3 py-2 text-realtor-muted transition hover:bg-realtor-primary/10 hover:text-realtor-primary"
            >
              {item.label}
            </a>
          ) : (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-xl px-3 py-2 text-realtor-muted transition hover:bg-realtor-primary/10 hover:text-realtor-primary"
            >
              {item.label}
            </Link>
          ),
        )}
        {signOutAction ? (
          <form action={signOutAction} className="mt-1 border-t border-realtor-primary/10 pt-1">
            <button
              type="submit"
              className="w-full rounded-xl px-3 py-2 text-left text-realtor-muted transition hover:bg-realtor-primary/10 hover:text-realtor-primary"
            >
              Sign out
            </button>
          </form>
        ) : null}
      </nav>
    </details>
  );
}
