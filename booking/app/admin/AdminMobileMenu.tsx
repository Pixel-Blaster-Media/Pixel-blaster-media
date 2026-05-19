"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import CopyAdminBookingLinkButton from "./CopyAdminBookingLinkButton";

type NavItem = {
  href: string;
  label: string;
};

export default function AdminMobileMenu({
  adminLabel,
  bookingUrl,
  nav,
  signOutAction,
}: {
  adminLabel: string;
  bookingUrl: string;
  nav: readonly NavItem[];
  signOutAction: () => void | Promise<void>;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (detailsRef.current) {
      detailsRef.current.open = false;
    }
  }, [pathname]);

  return (
    <details
      ref={detailsRef}
      className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/90 p-3 shadow-lg shadow-realtor-text/10"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-1 py-1 text-sm font-semibold text-realtor-text [&::-webkit-details-marker]:hidden">
        <span>
          Admin menu
          <span className="mt-0.5 block max-w-[220px] truncate text-xs font-normal text-realtor-muted">
            {adminLabel}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 flex-col items-center justify-center gap-1 rounded-full border border-realtor-primary/15 bg-realtor-primary/5 text-realtor-primary"
        >
          <span className="h-0.5 w-4 rounded-full bg-current" />
          <span className="h-0.5 w-4 rounded-full bg-current" />
          <span className="h-0.5 w-4 rounded-full bg-current" />
        </span>
      </summary>
      <nav className="mt-3 grid gap-1 border-t border-realtor-primary/10 pt-3 text-sm">
        <div className="mb-2 rounded-2xl border border-realtor-primary/15 bg-white/60 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-realtor-primary/80">
            Booking link
          </p>
          <p className="mt-1 truncate text-xs text-realtor-muted">{bookingUrl}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyAdminBookingLinkButton value={bookingUrl} compact />
            <Link
              href={bookingUrl}
              target="_blank"
              className="rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-[11px] font-semibold text-realtor-primary"
            >
              Preview
            </Link>
          </div>
        </div>
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => {
              if (detailsRef.current) {
                detailsRef.current.open = false;
              }
            }}
            className="rounded-xl px-3 py-2 text-realtor-muted transition hover:bg-realtor-primary/10 hover:text-realtor-primary"
          >
            {item.label}
          </Link>
        ))}
        <form action={signOutAction}>
          <button
            type="submit"
            className="mt-2 w-full rounded-xl border border-realtor-primary/15 px-3 py-2 text-left text-xs text-realtor-muted transition hover:border-realtor-primary/30 hover:bg-realtor-primary/5 hover:text-realtor-primary"
          >
            Sign out
          </button>
        </form>
      </nav>
    </details>
  );
}
