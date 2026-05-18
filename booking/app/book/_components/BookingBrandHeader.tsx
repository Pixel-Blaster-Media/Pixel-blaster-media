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
    <header
      className="rounded-3xl border border-realtor-primary/15 bg-realtor-surface/80 p-4 shadow-lg shadow-realtor-text/10 md:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          href={`/book?org=${organization.slug ?? ""}`}
          className="flex min-w-0 items-center gap-3 text-realtor-text"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-realtor-primary/10 text-sm font-bold text-realtor-primary ring-1 ring-realtor-primary/15">
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
            <span className="mt-0.5 block text-xs text-realtor-muted">
              Booking system
            </span>
          </span>
        </Link>
        <span className="rounded-full border border-realtor-primary/15 bg-realtor-primary/5 px-3 py-1 text-xs font-semibold text-realtor-primary">
          Secure booking
        </span>
      </div>

      <div className="mt-5 max-w-2xl">
        <h1 className="text-3xl font-bold text-realtor-text md:text-4xl">
          Book a shoot
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-realtor-muted">
          Premium real estate media, scheduled without the back-and-forth.
        </p>
      </div>
    </header>
  );
}
