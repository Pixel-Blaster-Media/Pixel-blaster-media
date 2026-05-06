import Link from "next/link";

import { getServerSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

import LinkEventForm from "./LinkEventForm";
import { ignoreIGuideWebhookEvents } from "./actions";

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

export default async function IGuideReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "all" ? "all" : "likely";
  const supabase = await getServerSupabase();
  const [{ data: events, error }, { data: bookings }] = await Promise.all([
    supabase
      .from("iguide_webhook_events")
      .select(
        "id, event_type, iguide_id, work_order_id, alias, payload_json, match_status, matched_booking_id, match_source, received_at, last_error",
      )
      .in("match_status", ["received", "unmatched", "failed"])
      .order("received_at", { ascending: false })
      .limit(200)
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
  const reviewItems = (events ?? []).map((event) => {
    const details = eventDetails(event.payload_json);
    const suggested = suggestBooking(details, bookingOptions);
    const hasSamePostal = Boolean(
      details.postal &&
        bookingOptions.some((booking) => booking.postal === details.postal),
    );
    return { event, details, suggested, hasSamePostal };
  });
  const likelyItems = reviewItems.filter(
    (item) => item.suggested || item.hasSamePostal,
  );
  const unrelatedItems = reviewItems.filter(
    (item) => !item.suggested && !item.hasSamePostal,
  );
  const visibleItems = view === "all" ? reviewItems : likelyItems;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
          iGUIDE
        </p>
        <h1 className="mt-1 text-2xl font-bold text-white">
          iGUIDEs needing a booking
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">
          This page is only for iGUIDEs the site could not safely match by
          itself. Pick the booking it belongs to, or hide it if it is not your
          shoot.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <InfoBox
          title="What shows up here"
          body="New ready webhooks from iGUIDE that did not clearly match one booking."
        />
        <InfoBox
          title="What does not"
          body="Old portal tours will not appear unless iGUIDE sends a new ready webhook."
        />
        <InfoBox
          title="Random shoots"
          body="If another account or editor sends events to this webhook, hide them with Not my shoot."
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 text-xs">
          <Link
            href="/admin/iguide"
            className={
              "rounded-md border px-3 py-1.5 transition " +
              (view === "likely"
                ? "border-brand-light bg-brand/15 text-brand-light"
                : "border-white/10 text-ink-muted hover:border-white/30 hover:text-white")
            }
          >
            Likely matches ({likelyItems.length})
          </Link>
          <Link
            href="/admin/iguide?view=all"
            className={
              "rounded-md border px-3 py-1.5 transition " +
              (view === "all"
                ? "border-brand-light bg-brand/15 text-brand-light"
                : "border-white/10 text-ink-muted hover:border-white/30 hover:text-white")
            }
          >
            All unmatched ({reviewItems.length})
          </Link>
        </nav>
        {view === "likely" && unrelatedItems.length > 0 ? (
          <form action={ignoreIGuideWebhookEvents}>
            {unrelatedItems.map((item) => (
              <input
                key={item.event.id}
                type="hidden"
                name="event_id"
                value={item.event.id}
              />
            ))}
            <button
              type="submit"
              className="rounded-md border border-red-300/30 px-3 py-1.5 text-xs text-red-200 hover:border-red-300 hover:bg-red-500/10"
            >
              Hide {unrelatedItems.length} unrelated iGUIDEs
            </button>
          </form>
        ) : null}
      </div>

      {visibleItems.length > 0 ? (
        <ul className="space-y-3">
          {visibleItems.map(({ event, details, suggested, hasSamePostal }) => {
            const status = statusCopy(event.match_status);
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
                    <p className="mt-1 text-sm text-ink-muted">
                      {suggested
                        ? "Possible match found. Check the dropdown, then link it."
                        : hasSamePostal
                          ? "Same postal code as a booking. Choose carefully before linking."
                          : "No matching postal code in current bookings. This is probably unrelated."}
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
                  <div className="text-right">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${status.classes}`}
                    >
                      {status.label}
                    </span>
                    <p className="mt-1 text-[10px] text-ink-muted">
                      {new Date(event.received_at).toLocaleString()}
                    </p>
                  </div>
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
          {view === "likely" && unrelatedItems.length > 0
            ? "No likely matches. The remaining iGUIDEs look unrelated to current bookings."
            : "Nothing to review. If an iGUIDE comes in and the site cannot match it, it will show up here."}
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

function InfoBox({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-ink-soft/40 p-4">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-1 text-xs text-ink-muted">{body}</p>
    </div>
  );
}

function statusCopy(status: string): { label: string; classes: string } {
  if (status === "failed") {
    return {
      label: "Needs help",
      classes: "border-red-300/40 text-red-200",
    };
  }
  if (status === "received") {
    return {
      label: "New",
      classes: "border-brand-light/50 text-brand-light",
    };
  }
  return {
    label: "Needs review",
    classes: "border-amber-300/40 text-amber-200",
  };
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
