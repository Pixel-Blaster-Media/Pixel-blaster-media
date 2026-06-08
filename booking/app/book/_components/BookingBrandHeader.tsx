import Link from "next/link";
import type { ReactNode } from "react";

import {
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
  const mainImageUrl = organization.bookingHeroImageUrl;
  const secondaryImageUrl = organization.bookingHeroSecondaryImageUrl;

  return (
    <header className="booking-hero">
      <div className="booking-hero-grid">
        <div className="booking-hero-copy">
          <span className="booking-hero-pill">Real estate media booking</span>
          <h1>Book a shoot. Skip the back-and-forth.</h1>
          <p>
            Pick a package, add the property details, choose a time, and your
            shoot is ready to go.
          </p>
          <p className="booking-hero-login">
            Already have a profile?{" "}
            <Link href="/auth/sign-in?next=/portal">
              Log in to view your media and bookings
            </Link>
            .
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
            <span>{mainImageUrl ? "Featured work" : "Photos"}</span>
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
            <span>Media</span>
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
