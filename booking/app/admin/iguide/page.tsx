import Link from "next/link";

import { getServerSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

import LinkEventForm from "./LinkEventForm";

export const metadata = { title: "iGUIDE Review" };
export const dynamic = "force-dynamic";

interface IGuideEventRow {
  id: string;
  event_type: string;
  iguide_id: string;
  work_order_id: string | null;
  alias: string | null;
  payload_json: Json;
  match_status: string;
  matched_booking_id: string | null;
  match_source: string | null;
  received_at: string;
  last_error: string | null;
}

interface BookingOptionRow {
  id: string;
  scheduled_at: string | null;
  status: string;
  properties: {
    street_address: string;
    city: string | null;
    postal_code: string | null;
  } | null;
  profiles: {
    full_name: string | null;
    email: string;
  } | null;
}

export default async function IGuideReviewPage() {
  const supabase = getServerSupabase();
  const [{ data: events, error }, { data: bookings }] = await Promise.all([
    supabase
      .from("iguide_webhook_events")
      .select(
        "id, event_type, iguide_id, work_order_id, alias, payload_json, match_status, matched_booking_id, match_source, received_at, last_error",
      )
      .in("match_status", ["received", "unmatched", "failed"])
      .order("received_at", { ascending: false })
      .limit(50)
      .returns<IGuideEventRow[]>(),
    supabase
      .from("bookings")
      .select(
        "id, scheduled_at, status, properties(street_address, city, postal_code), profiles(full_name, email)",
      )
      .in("status", ["requested", "confirmed", "shot", "editing", "delivered"])
      .order("scheduled_at", { ascending: false, nullsFirst: false })
      .limit(200)
      .returns<BookingOptionRow[]>(),
  ]);

  if (error) {
    return (
      <p className="text-sm text-red-300">
        Could not load iGUIDE review queue: {error.message}
      </p>
    );
  }

  const bookingOptions = (bookings ?? []).map((booking) => ({
    id: booking.id,
    label: formatBookingLabel(booking),
    normalizedAddress: normalizeAddress(
      [
        booking.properties?.street_address,
        booking.properties?.city,
        booking.properties?.postal_code,
      ]
        .filter(Boolean)
        .join(" "),
    ),
    postal: normalizePostalCode(booking.properties?.postal_code),
  }));

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
          iGUIDE
        </p>
        <h1 className="mt-1 text-2xl font-bold text-white">Review queue</h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">
          Phone uploads can create brand-new iGUIDEs in the portal. If the
          webhook cannot match one confidently, it lands here so you can attach
          it to the correct booking.
        </p>
      </header>

      {events && events.length > 0 ? (
        <ul className="space-y-3">
          {events.map((event) => {
            const details = eventDetails(event.payload_json);
            const suggested = suggestBooking(details, bookingOptions);
            return (
              <li
                key={event.id}
                className="rounded-lg border border-white/10 bg-ink-soft/50 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">
                      {details.address || event.alias || event.iguide_id}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      Portal ID:{" "}
                      <code className="rounded bg-black/30 px-1 py-0.5 text-[11px] text-white/90">
                        {event.iguide_id}
                      </code>
                      {event.work_order_id ? ` · Work order ${event.work_order_id}` : ""}
                      {event.alias ? ` · ${event.alias}` : ""}
                    </p>
                    {event.last_error ? (
                      <p className="mt-1 text-xs text-red-300">
                        {event.last_error}
                      </p>
                    ) : null}
                  </div>
                  <span className="rounded-full border border-amber-300/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-200">
                    {event.match_status}
                  </span>
                </div>

                <LinkEventForm
                  eventId={event.id}
                  bookings={bookingOptions}
                  suggestedBookingId={suggested?.id ?? null}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-white/10 bg-ink-soft/40 px-4 py-8 text-center text-sm text-ink-muted">
          Nothing to review. New ready events that cannot auto-match will show up
          here.
        </p>
      )}

      <p className="text-xs text-ink-muted">
        Matched iGUIDEs appear on the relevant{" "}
        <Link href="/admin/bookings" className="text-brand-light underline">
          booking
        </Link>
        .
      </p>
    </div>
  );
}

function formatBookingLabel(booking: BookingOptionRow): string {
  const address = [
    booking.properties?.street_address,
    booking.properties?.city,
    booking.properties?.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
  const realtor = booking.profiles?.full_name ?? booking.profiles?.email ?? "No realtor";
  const date = booking.scheduled_at
    ? new Date(booking.scheduled_at).toLocaleDateString()
    : "No date";
  return `${address || "No address"} - ${realtor} - ${date}`;
}

function eventDetails(payload: Json): {
  address: string;
  postal: string;
  normalizedAddress: string;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { address: "", postal: "", normalizedAddress: "" };
  }
  const property = (payload as Record<string, unknown>).property;
  if (!property || typeof property !== "object" || Array.isArray(property)) {
    return { address: "", postal: "", normalizedAddress: "" };
  }
  const p = property as Record<string, unknown>;
  const address =
    stringValue(p.fullAddress) ||
    [
      stringValue(p.streetNumber),
      stringValue(p.streetName),
      stringValue(p.city),
      stringValue(p.postalCode),
    ]
      .filter(Boolean)
      .join(" ");
  return {
    address,
    postal: normalizePostalCode(stringValue(p.postalCode)),
    normalizedAddress: normalizeAddress(address),
  };
}

function suggestBooking(
  details: ReturnType<typeof eventDetails>,
  bookings: Array<{ id: string; normalizedAddress: string; postal: string }>,
) {
  if (!details.normalizedAddress || !details.postal) return null;
  const matches = bookings.filter(
    (booking) =>
      booking.postal === details.postal &&
      (booking.normalizedAddress === details.normalizedAddress ||
        booking.normalizedAddress.includes(details.normalizedAddress) ||
        details.normalizedAddress.includes(booking.normalizedAddress)),
  );
  return matches.length === 1 ? matches[0] : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizePostalCode(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").toUpperCase();
}

function normalizeAddress(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(court|ct)\b/g, "ct")
    .replace(/\b(lane|ln)\b/g, "ln")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
