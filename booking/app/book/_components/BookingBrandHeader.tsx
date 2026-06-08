import Link from "next/link";
import type { ReactNode } from "react";

import {
  initialsForOrganization,
  organizationThemeStyle,
  type OrganizationBrand,
} from "@/lib/organizations/branding";

export function BookingBrandFrame({
  organization,
  children,
}: {
  organization: OrganizationBrand;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6" style={organizationThemeStyle(organization)}>
      {children}
    </div>
  );
}

export default function BookingBrandHeader({
  organization,
}: {
  organization: OrganizationBrand;
}) {
  return (
    <header className="booking-hero">
      <nav className="booking-hero-nav">
        <Link
          href={`/book?org=${organization.slug ?? ""}`}
          className="flex min-w-0 items-center gap-3 text-realtor-text"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white text-sm font-bold text-realtor-primary ring-1 ring-realtor-primary/20">
            {organization.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={organization.logoUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              initialsForOrganization(organization.name)
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {organization.name}
            </span>
            <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-[0.16em] text-realtor-muted">
              Booking
            </span>
          </span>
        </Link>
        <Link
          href="/auth/sign-in?next=/portal"
          className="shrink-0 rounded-full border border-realtor-primary/20 bg-white px-4 py-2 text-xs font-semibold text-realtor-primary shadow-sm shadow-realtor-text/5 transition hover:border-realtor-primary/45 hover:bg-realtor-surface-muted/50"
        >
          Realtor login
        </Link>
      </nav>

      <div className="booking-hero-grid">
        <div className="booking-hero-copy">
          <span className="booking-hero-pill">Real estate media booking</span>
          <h1>Book a shoot. Skip the back-and-forth.</h1>
          <p>
            Pick a package, add the property details, choose a time, and your
            shoot is ready to go.
          </p>
          <div className="booking-hero-actions">
            <a href="#packages" className="booking-hero-primary">
              Choose a package
            </a>
            <Link href="/auth/sign-in?next=/portal" className="booking-hero-secondary">
              View your portal
            </Link>
          </div>
          <p className="booking-hero-login">
            Already have a profile?{" "}
            <Link href="/auth/sign-in?next=/portal">
              Log in to view your media and bookings
            </Link>
            .
          </p>
        </div>

        <div className="booking-hero-visual" aria-hidden="true">
          <div className="booking-media-tile booking-media-tile-large">
            <span>Photos</span>
          </div>
          <div className="booking-media-tile booking-media-tile-small">
            <span>iGUIDE</span>
          </div>
          <div className="booking-media-panel">
            <div>
              <span className="booking-media-kicker">Next step</span>
              <strong>Choose the best fit</strong>
            </div>
            <span className="booking-media-check">✓</span>
          </div>
          <div className="booking-media-strip">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </header>
  );
}
