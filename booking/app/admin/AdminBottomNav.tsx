"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * App-wide mobile bottom tab bar for the admin. Mirrors the global nav
 * taxonomy (Today / Bookings / Calendar / Realtors / Settings) so the
 * hamburger menu and the tab bar never disagree, and gives the
 * installed home-screen app a native-feeling persistent nav.
 * Desktop uses the site header; this renders only below md.
 */
const TABS = [
  {
    href: "/admin/today",
    label: "Today",
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <line x1="12" y1="2" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="2" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="22" y2="12" />
      </>
    ),
  },
  {
    href: "/admin/bookings",
    label: "Bookings",
    icon: (
      <>
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </>
    ),
  },
  {
    href: "/admin/calendar",
    label: "Calendar",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="17" rx="3" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="16" y1="2" x2="16" y2="6" />
      </>
    ),
  },
  {
    href: "/admin/realtors",
    label: "Realtors",
    icon: (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
  },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: (
      <>
        <line x1="4" y1="7" x2="20" y2="7" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="17" x2="20" y2="17" />
      </>
    ),
  },
] as const;

export default function AdminBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin sections"
      className="fixed inset-x-4 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 rounded-[28px] border border-[#d8cab9]/70 bg-white/95 px-2 py-2 shadow-2xl shadow-black/15 backdrop-blur md:hidden"
    >
      <div className="grid grid-cols-5 gap-1 text-[11px] font-semibold text-[#6f7a70]">
        {TABS.map((tab) => (
          <Tab
            key={tab.href}
            href={tab.href}
            label={tab.label}
            active={
              pathname === tab.href ||
              (pathname?.startsWith(`${tab.href}/`) ?? false)
            }
          >
            {tab.icon}
          </Tab>
        ))}
      </div>
    </nav>
  );
}

function Tab({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        "flex flex-col items-center gap-1 rounded-2xl px-1 py-2 " +
        (active ? "bg-[#f0f3ef] text-[#23332b]" : "")
      }
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
      >
        {children}
      </svg>
      {label}
    </Link>
  );
}
