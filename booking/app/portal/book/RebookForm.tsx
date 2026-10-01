"use client";

import { useActionState } from "react";
import { startSimilarBooking } from "./actions";

export default function RebookForm({ propertyId, bookingId }: { propertyId: string; bookingId?: string }) {
  const [result, action, pending] = useActionState(startSimilarBooking, null);
  return <form action={action}>
    <input type="hidden" name="property_id" value={propertyId} />
    <input type="hidden" name="booking_id" value={bookingId ?? ""} />
    <button type="submit" disabled={pending}
      className="rounded-xl border border-realtor-primary/15 bg-realtor-surface px-4 py-2 text-sm font-semibold text-realtor-text transition hover:border-realtor-primary/35 hover:bg-realtor-surface-muted disabled:opacity-60">
      {pending ? "Opening booking…" : "Book similar shoot"}
    </button>
    {result?.error ? <p role="alert" className="mt-2 text-sm">{result.error}</p> : null}
  </form>;
}
