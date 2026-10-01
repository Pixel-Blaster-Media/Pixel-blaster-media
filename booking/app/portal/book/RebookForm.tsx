export default function RebookForm({ propertyId, bookingId }: { propertyId: string; bookingId?: string }) {
  // The POST must reach /book so its Path=/book cookies are visible to pruning.
  // Moving a Server Action module alone would still POST to the portal page.
  return <form action="/book/rebook" method="post">
    <input type="hidden" name="property_id" value={propertyId} />
    <input type="hidden" name="booking_id" value={bookingId ?? ""} />
    <button type="submit"
      className="rounded-xl border border-realtor-primary/15 bg-realtor-surface px-4 py-2 text-sm font-semibold text-realtor-text transition hover:border-realtor-primary/35 hover:bg-realtor-surface-muted">
      Book similar shoot
    </button>
  </form>;
}
