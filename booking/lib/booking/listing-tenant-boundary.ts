interface OwnedRelation {
  id: string;
  organization_id: string;
  owner_id: string;
}
interface ListingRelation {
  organization_id: string;
  owner_id: string;
  property_id: string;
  booking_id: string | null;
}

/** Service-role reads must independently reject legacy/corrupt relations. */
export function validListingRelations(
  website: ListingRelation,
  property: OwnedRelation | null,
  booking?: (OwnedRelation & { property_id: string }) | null,
): boolean {
  if (!website.organization_id || !website.owner_id || !property) return false;
  if (property.id !== website.property_id ||
      property.organization_id !== website.organization_id ||
      property.owner_id !== website.owner_id) return false;
  return website.booking_id === null || Boolean(
    booking && booking.id === website.booking_id &&
    booking.organization_id === website.organization_id &&
    booking.owner_id === website.owner_id &&
    booking.property_id === website.property_id,
  );
}
