"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { Bot, CalendarDays, Camera, Inbox, LogOut, MoreHorizontal, Search, Settings, SunMedium, UsersRound, ScanLine } from "lucide-react";

const navigation = [
  { href: "/admin/today", label: "Today", icon: SunMedium },
  { href: "/admin/bookings", label: "Bookings", icon: Camera },
  { href: "/admin/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/admin/realtors", label: "Realtors", icon: UsersRound },
  { href: "/admin/inbox", label: "Inbox", icon: Inbox },
] as const;

export default function AdminWorkspace({ name, logoUrl, signOutAction, children }: {
  name: string;
  logoUrl: string | null;
  signOutAction: () => Promise<void>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const moreRef = useRef<HTMLDetailsElement>(null);
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const section = navigation.find(item => active(item.href))?.label ?? (pathname.startsWith("/admin/settings") ? "Settings" : "Workspace");
  useEffect(() => { if (moreRef.current) moreRef.current.open = false; }, [pathname]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && moreRef.current?.open) {
        moreRef.current.open = false;
        moreRef.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, []);
  const brand = <Link href="/admin/today" className="studio-brand">
    <span className="studio-brand-mark" aria-hidden="true" style={logoUrl ? { backgroundImage: `url(${logoUrl})` } : undefined}>{!logoUrl ? "PB" : null}</span>
    <span><strong>{name}</strong><small>Media · workspace</small></span>
  </Link>;
  const assistant = <button type="button" onClick={() => { if (moreRef.current) moreRef.current.open = false; window.dispatchEvent(new Event("pixel-assistant:open")); }}><Bot aria-hidden="true" size={20} />Assistant</button>;
  const signOut = <form action={signOutAction} data-pixel-logout><button type="submit"><LogOut aria-hidden="true" size={20} />Sign out</button></form>;
  return <>
    <a className="studio-skip-link" href="#studio-content">Skip to workspace</a>
    <aside className="studio-sidebar">
      {brand}
      <p className="studio-nav-label">Your workspace</p>
      <nav aria-label="Workspace navigation">
        {navigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={active(href) ? "page" : undefined}><Icon aria-hidden="true" size={20} />{label}</Link>)}
      </nav>
      <p className="studio-nav-label">Studio tools</p>
      <nav aria-label="Studio tools">
        {assistant}
        <Link href="/admin/iguide" aria-current={active("/admin/iguide") ? "page" : undefined}><ScanLine aria-hidden="true" size={20} />iGUIDE</Link>
        <Link href="/admin/settings" aria-current={active("/admin/settings") ? "page" : undefined}><Settings aria-hidden="true" size={20} />Settings</Link>
      </nav>
      <div className="studio-sidebar-footer">{signOut}</div>
    </aside>
    <div className="studio-main">
      <header className="studio-topbar">
        <div className="studio-mobile-brand">{brand}</div>
        <p className="studio-breadcrumb">Workspace <span aria-hidden="true">/</span> <strong>{section}</strong></p>
        <form action="/admin/bookings" role="search" className="studio-global-search">
          <Search aria-hidden="true" size={18} /><label className="sr-only" htmlFor="studio-search">Find a booking by address or realtor</label>
          <input id="studio-search" name="q" type="search" placeholder="Find a booking…" />
          <input type="hidden" name="filter" value="all" />
          <button type="submit" aria-label="Search bookings">↵</button>
        </form>
      </header>
      <div id="studio-content" tabIndex={-1} className="studio-content">{children}</div>
    </div>
    <nav className="studio-bottom-nav" aria-label="Mobile workspace navigation">
      {[navigation[0], navigation[2], navigation[1], navigation[3]].map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={active(href) ? "page" : undefined}><Icon aria-hidden="true" size={21} /><span>{label}</span></Link>)}
      <details ref={moreRef} className="studio-more">
        <summary><MoreHorizontal aria-hidden="true" size={21} /><span>More</span></summary>
        <div className="studio-more-menu">
          <Link href="/admin/inbox"><Inbox aria-hidden="true" size={20} />Inbox</Link>
          {assistant}
          <Link href="/admin/iguide"><ScanLine aria-hidden="true" size={20} />iGUIDE</Link>
          <Link href="/admin/settings"><Settings aria-hidden="true" size={20} />Settings</Link>
          {signOut}
        </div>
      </details>
    </nav>
  </>;
}
