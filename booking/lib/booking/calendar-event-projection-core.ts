import {
  buildBookingGoogleCalendarEventInput,
  type BookingCalendarSelectionItem,
} from "./calendar-event-details.ts";
import type { BookingGoogleCalendarEventInput } from "./calendar-event-sync.ts";

export interface StoredBookingCalendarProjectionRow {
  id: string;
  organization_id: string;
  status: string;
  scheduled_at: string | null;
  scheduled_ends_at: string | null;
  services: string[];
  add_ons: string[];
  square_footage: number | null;
  unit_number: string | null;
  is_vacant: "vacant" | "occupied" | "partial" | null;
  include_basement: boolean | null;
  client_notes: string | null;
  suppress_realtor_notifications: boolean;
  google_calendar_event_id: string | null;
  updated_at: string;
  properties: {
    street_address: string;
    city: string | null;
    postal_code: string | null;
  } | null;
  profiles: {
    email: string;
    full_name: string | null;
    phone: string | null;
    brokerage: string | null;
  } | null;
}

export function buildStoredBookingGoogleCalendarEventInput({
  booking,
  items,
}: {
  booking: StoredBookingCalendarProjectionRow;
  items: readonly BookingCalendarSelectionItem[];
}): BookingGoogleCalendarEventInput {
  if (!booking.scheduled_at || !booking.scheduled_ends_at) {
    throw new Error("Cannot build a Google Calendar event without a complete schedule");
  }

  const street = booking.unit_number
    ? `${booking.properties?.street_address ?? ""}, Unit ${booking.unit_number}`
    : (booking.properties?.street_address ?? "");
  const occupancy = booking.is_vacant === "vacant"
    ? "Vacant"
    : booking.is_vacant === "partial"
      ? "Partially occupied"
      : booking.is_vacant === "occupied"
        ? "Occupied"
        : null;

  return buildBookingGoogleCalendarEventInput({
    bookingId: booking.id,
    organizationId: booking.organization_id,
    realtorName:
      booking.profiles?.full_name ?? booking.profiles?.email ?? "Realtor",
    realtorEmail: booking.profiles?.email,
    realtorPhone: booking.profiles?.phone,
    brokerage: booking.profiles?.brokerage,
    items,
    street,
    location: [
      street,
      booking.properties?.city,
      booking.properties?.postal_code,
    ]
      .filter(Boolean)
      .join(", "),
    startISO: booking.scheduled_at,
    endISO: booking.scheduled_ends_at,
    notes: booking.client_notes,
    additionalDetails: [
      booking.square_footage
        ? `Size: ~${booking.square_footage} sqft`
        : "",
      occupancy ? `Occupancy: ${occupancy}` : "",
      booking.include_basement != null
        ? `Basement: ${booking.include_basement ? "include" : "skip"}`
        : "",
    ],
    attendee: booking.suppress_realtor_notifications
      ? null
      : {
          email: booking.profiles?.email,
          name: booking.profiles?.full_name,
        },
  });
}

/** Calendar-visible state only; linkage and timestamps do not alter payload. */
export function storedBookingCalendarPayloadFingerprint(
  booking: StoredBookingCalendarProjectionRow,
  items: readonly BookingCalendarSelectionItem[],
): string {
  return JSON.stringify([
    booking.id,
    booking.organization_id,
    booking.status,
    booking.scheduled_at,
    booking.scheduled_ends_at,
    booking.services,
    booking.add_ons,
    items.map((item) => [item.name.trim(), item.kind]),
    booking.square_footage,
    booking.unit_number,
    booking.is_vacant,
    booking.include_basement,
    booking.client_notes,
    booking.suppress_realtor_notifications,
    booking.properties?.street_address ?? null,
    booking.properties?.city ?? null,
    booking.properties?.postal_code ?? null,
    booking.profiles?.email ?? null,
    booking.profiles?.full_name ?? null,
    booking.profiles?.phone ?? null,
    booking.profiles?.brokerage ?? null,
  ]);
}
