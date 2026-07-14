"use client";

import {
  Bot,
  CalendarDays,
  Camera,
  SunMedium,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";

const TABS: Array<{
  href: string;
  label: string;
  icon: LucideIcon;
}> = [
  { href: "/admin/today", label: "Today", icon: SunMedium },
  { href: "/admin/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/admin/bookings", label: "Bookings", icon: Camera },
  { href: "/admin/realtors", label: "Realtors", icon: UsersRound },
];

export default function AdminBottomNav() {
  const pathname = usePathname();
  const [assistantOpen, setAssistantOpen] = useState(false);

  useEffect(() => {
    const update = (event: Event) => {
      setAssistantOpen(Boolean((event as CustomEvent<{ open: boolean }>).detail?.open));
    };
    window.addEventListener("pixel-assistant:state", update);
    return () => window.removeEventListener("pixel-assistant:state", update);
  }, []);

  return (
    <nav
      aria-label="Admin app navigation"
      className="fixed bottom-[max(0.55rem,env(safe-area-inset-bottom))] left-3 right-3 z-[210] mx-auto max-w-md rounded-[24px] border border-realtor-primary/15 bg-white/95 px-2 py-1.5 shadow-[0_12px_38px_rgba(35,51,43,0.22)] backdrop-blur-xl md:hidden"
    >
      <div className="mx-auto grid max-w-lg grid-cols-5 items-end text-[10px] font-semibold text-realtor-muted">
        <NavTab tab={TABS[0]} pathname={pathname} />
        <NavTab tab={TABS[1]} pathname={pathname} />
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("pixel-assistant:open"))}
          aria-label="Open Pixel Assistant"
          aria-pressed={assistantOpen}
          className={`flex min-h-14 flex-col items-center justify-end gap-1 px-1 pb-1 transition ${
            assistantOpen ? "text-realtor-primary" : "text-realtor-muted"
          }`}
        >
          <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full border-4 border-white bg-realtor-primary text-white shadow-lg shadow-realtor-primary/25">
            <Bot aria-hidden="true" className="h-5 w-5" strokeWidth={2.2} />
          </span>
          <span>AI</span>
        </button>
        <NavTab tab={TABS[2]} pathname={pathname} />
        <NavTab tab={TABS[3]} pathname={pathname} />
      </div>
    </nav>
  );
}

function NavTab({
  tab,
  pathname,
}: {
  tab: (typeof TABS)[number];
  pathname: string;
}) {
  const active =
    pathname === tab.href || pathname.startsWith(`${tab.href}/`);
  const Icon = tab.icon;

  return (
    <Link
      href={tab.href}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-14 flex-col items-center justify-end gap-1 px-1 pb-1 transition ${
        active ? "text-realtor-primary" : "text-realtor-muted"
      }`}
    >
      {active ? (
        <span className="absolute top-0 h-0.5 w-8 rounded-full bg-realtor-primary" />
      ) : null}
      <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={active ? 2.4 : 1.9} />
      <span>{tab.label}</span>
    </Link>
  );
}
