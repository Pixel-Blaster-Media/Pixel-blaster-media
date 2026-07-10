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
  compact = false,
}: {
  organization: OrganizationBrand;
  compact?: boolean;
}) {
  const mainImageUrl = organization.bookingHeroImageUrl;
  const secondaryImageUrl = organization.bookingHeroSecondaryImageUrl;
  const logoUrl = organization.logoUrl;

  if (compact) {
    return (
      <header className="booking-compact-header">
        <div className="booking-hero-brand">
          <span className="booking-hero-brand-logo" aria-hidden={!logoUrl}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={`${organization.name} logo`} />
            ) : (
              <span>{initialsForOrganization(organization.name)}</span>
            )}
          </span>
          <span className="booking-hero-brand-name">{organization.name}</span>
        </div>
        <p>Booking in progress</p>
      </header>
    );
  }

  return (
    <header className="booking-hero">
      <div className="booking-hero-grid">
        <div className="booking-hero-copy">
          <div className="booking-hero-brand">
            {logoUrl ? (
              <span className="booking-hero-brand-logo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoUrl} alt={`${organization.name} logo`} />
              </span>
            ) : null}
            <span className="booking-hero-brand-name">{organization.name}</span>
          </div>
          <span className="booking-hero-pill">Real estate media booking</span>
          <h1>Book a shoot. Skip the back-and-forth.</h1>
          <p>
            Pick a package, add the property details, choose a time, and your
            shoot is ready to go.
          </p>
        </div>

        <div className="booking-hero-visual" aria-hidden="true">
          <div
            className={`booking-media-tile booking-media-tile-large ${
              mainImageUrl ? "booking-media-tile-has-image" : ""
            }`}
          >
            {mainImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mainImageUrl}
                alt=""
                className="booking-media-photo"
              />
            ) : null}
          </div>
          <div
            className={`booking-media-tile booking-media-tile-small ${
              secondaryImageUrl ? "booking-media-tile-has-image" : ""
            }`}
          >
            {secondaryImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={secondaryImageUrl}
                alt=""
                className="booking-media-photo"
              />
            ) : null}
          </div>
          <div className="booking-media-panel">
            <div>
              <span className="booking-media-kicker">Next step</span>
              <strong>Choose the best fit</strong>
            </div>
            <span className="booking-media-check">✓</span>
          </div>
        </div>
      </div>
    </header>
  );
}
