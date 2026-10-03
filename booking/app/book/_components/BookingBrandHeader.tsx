import type { ReactNode } from "react";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";

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
    <div className="booking-refresh space-y-6" data-pixel-default-palette={organization.id === DEFAULT_ORGANIZATION_ID ? true : undefined} style={organizationThemeStyle(organization)}>
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
  const mainImageUrl = organization.bookingHeroImageUrl ?? organization.bookingHeroSecondaryImageUrl;
  const logoUrl = organization.logoUrl;

  return (
    <header className={compact ? "booking-refresh-header is-compact" : "booking-refresh-header"}>
      <div className="booking-refresh-brandline">
        <div className="booking-refresh-brand">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" width={48} height={48} />
          ) : (
            <span className="booking-refresh-monogram" aria-hidden="true">
              {initialsForOrganization(organization.name)}
            </span>
          )}
          <span>{organization.name}</span>
        </div>
        <p>{compact ? "Booking in progress" : "Real estate photography & media"}</p>
      </div>
      {!compact ? (
        <div className={`booking-refresh-hero${mainImageUrl ? " has-photo" : ""}`}>
          <div className="booking-refresh-hero-copy">
            <h1>Book your next listing.</h1>
            <p>Choose your package. Then make it yours.</p>
          </div>
          {mainImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="booking-refresh-hero-photo" src={mainImageUrl} alt="" fetchPriority="high" />
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
