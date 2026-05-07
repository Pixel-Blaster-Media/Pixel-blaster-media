import Link from "next/link";

import {
  listIGuides,
  type IGuideListItem,
} from "@/lib/integrations/iguide/portal-client";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

import LinkEventForm from "./LinkEventForm";
import {
  ignoreIGuideWebhookEvents,
  linkIGuidePortalTour,
  linkManualIGuideToBooking,
} from "./actions";

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

interface LinkedIGuideBookingRow extends BookingOptionRow {
  iguide_id: string | null;
  iguide_portal_id: string | null;
}

export default async function IGuideReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "all" ? "all" : "likely";
  const portalQuery = (params.q ?? "").trim();
  const supabase = await getServerSupabase();
  const [
    { data: events, error },
    { data: bookings },
    { data: linkedBookings },
    portalTours,
  ] = await Promise.all([
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
    supabase
      .from("bookings")
      .select(
        "id, scheduled_at, status, iguide_id, iguide_portal_id, properties(street_address, city, postal_code), profiles(full_name, email)",
      )
      .or("iguide_id.not.is.null,iguide_portal_id.not.is.null")
      .order("scheduled_at", { ascending: false, nullsFirst: false })
      .limit(50)
      .returns<LinkedIGuideBookingRow[]>(),
    listIGuides(),
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
  const visiblePortalTours = filterPortalTours(
    portalTours.data ?? [],
    portalQuery,
  ).slice(0, 30);

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-white/10 bg-ink-soft/55 p-4 shadow-lg shadow-black/10">
        <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
          iGUIDE
        </p>
        <h1 className="mt-1 text-2xl font-bold text-white">
          iGUIDEs needing a booking
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">
          Review iGUIDEs the site could not safely match by itself, and quickly
          confirm which bookings already have iGUIDE media attached.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <InfoBox
          title="Needs review"
          body={`${reviewItems.length} incoming iGUIDE event${
            reviewItems.length === 1 ? "" : "s"
          } still need a booking decision.`}
        />
        <InfoBox
          title="Already linked"
          body={`${linkedBookings?.length ?? 0} booking${
            (linkedBookings?.length ?? 0) === 1 ? "" : "s"
          } already have an iGUIDE alias or portal ID saved.`}
        />
        <InfoBox
          title="Why random shoots appear"
          body="The webhook can receive events from the iGUIDE account/app that sends to this URL. Hide anything that is not your shoot."
        />
      </div>

      {linkedBookings && linkedBookings.length > 0 ? (
        <section className="rounded-2xl border border-white/10 bg-ink-soft/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">
                Bookings already linked to iGUIDE
              </h2>
              <p className="mt-1 text-xs text-ink-muted">
                These will not show in the review queue because the site already
                knows which booking they belong to.
              </p>
            </div>
            <Link
              href="/admin/bookings"
              className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-ink-muted hover:border-white/30 hover:text-white"
            >
              Open bookings
            </Link>
          </div>
          <ul className="mt-4 grid gap-2 md:grid-cols-2">
            {linkedBookings.slice(0, 6).map((booking) => (
              <li
                key={booking.id}
                className="rounded-2xl border border-white/10 bg-black/20 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      {formatBookingAddress(booking)}
                    </p>
                    <p className="mt-1 truncate text-xs text-ink-muted">
                      {booking.profiles?.full_name ??
                        booking.profiles?.email ??
                        "No realtor"}{" "}
                      · {formatBookingDate(booking.scheduled_at)}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-ink-muted">
                      {booking.iguide_portal_id
                        ? `Portal ${booking.iguide_portal_id}`
                        : "No portal ID"}
                      {booking.iguide_id ? ` · ${booking.iguide_id}` : ""}
                    </p>
                  </div>
                  <Link
                    href={`/admin/bookings/${booking.id}`}
                    className="shrink-0 rounded-full bg-brand px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand-light"
                  >
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          {linkedBookings.length > 6 ? (
            <p className="mt-3 text-xs text-ink-muted">
              Showing the newest 6 linked bookings.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-brand-light/20 bg-brand/10 p-4">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Link an iGUIDE manually
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            If portal search is blocked, paste the public tour URL, unbranded
            URL, manage URL, alias, or Portal ID here. Pick the booking and
            the site will save it and try to sync deliverables.
          </p>
        </div>
        <form
          action={linkManualIGuideToBooking}
          className="mt-4 grid gap-2 lg:grid-cols-[minmax(220px,1fr)_minmax(260px,420px)_auto]"
        >
          <input
            type="text"
            name="iguide_ref"
            required
            placeholder="Paste iGUIDE link, alias, or Portal ID"
            className="rounded-full border border-white/10 bg-ink-soft px-3 py-2 text-sm text-white placeholder-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-brand-light/60"
          />
          <select
            name="booking_id"
            required
            className="min-w-0 rounded-xl border border-white/10 bg-ink-soft px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-light/60"
            defaultValue=""
          >
            <option value="" disabled>
              Pick booking
            </option>
            {bookingOptions.map((booking) => (
              <option key={booking.id} value={booking.id}>
                {booking.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light"
          >
            Link + sync
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-white/10 bg-ink-soft/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Search your iGUIDE portal
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              Use this when an iGUIDE exists in your portal but did not arrive
              through the webhook. Pick the booking, then link and sync it.
            </p>
          </div>
          <Link
            href="/admin/settings/integrations"
            className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-ink-muted hover:border-white/30 hover:text-white"
          >
            iGUIDE settings
          </Link>
        </div>

        <form className="mt-4 grid gap-2 md:grid-cols-[1fr_auto]">
          <input
            type="search"
            name="q"
            defaultValue={portalQuery}
            placeholder="Search address, alias, or Portal ID"
            className="rounded-full border border-white/10 bg-ink-soft px-3 py-2 text-sm text-white placeholder-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-brand-light/60"
          />
          <button
            type="submit"
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light"
          >
            Search
          </button>
        </form>

        {!portalTours.ok ? (
          <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-400/10 p-4">
            <p className="text-sm font-semibold text-amber-100">
              iGUIDE is blocking portal search for this token.
            </p>
            <p className="mt-1 text-xs text-amber-100/80">
              The credentials are saved and iGUIDE accepts them, but their API
              is refusing the portal list endpoint. If your token already has
              <code className="mx-1">iguide.list</code> checked, ask iGUIDE
              whether this account/app role is allowed to list iGUIDEs through
              <code className="mx-1">GET /iguides</code>.
            </p>
            {portalTours.error ? (
              <p className="mt-2 text-[11px] text-amber-100/70">
                iGUIDE said: {portalTours.error}
              </p>
            ) : null}
          </div>
        ) : visiblePortalTours.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {visiblePortalTours.map((tour) => (
              <PortalTourRow
                key={tour.id}
                tour={tour}
                bookings={bookingOptions}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-ink-muted">
            {portalQuery
              ? "No portal iGUIDEs matched that search."
              : "No portal iGUIDEs came back from iGUIDE yet."}
          </p>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 text-xs">
          <Link
            href="/admin/iguide"
            className={
              "rounded-full border px-3 py-1.5 transition " +
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
              "rounded-full border px-3 py-1.5 transition " +
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
              className="rounded-full border border-red-300/30 px-3 py-1.5 text-xs text-red-200 hover:border-red-300 hover:bg-red-500/10"
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
                className="rounded-2xl border border-white/10 bg-ink-soft/50 p-4"
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
        <div className="rounded-2xl border border-dashed border-white/10 bg-ink-soft/40 px-4 py-8 text-center">
          <p className="text-sm text-ink-muted">
            {view === "likely" && unrelatedItems.length > 0
              ? "No likely matches. The remaining iGUIDEs look unrelated to current bookings."
              : "Nothing to review. If an iGUIDE comes in and the site cannot match it, it will show up here."}
          </p>
          {view === "likely" && unrelatedItems.length > 0 ? (
            <Link
              href="/admin/iguide?view=all"
              className="mt-3 inline-flex rounded-full border border-white/10 px-3 py-1.5 text-xs text-brand-light hover:border-brand-light"
            >
              See all unmatched iGUIDEs
            </Link>
          ) : null}
        </div>
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
    <div className="rounded-2xl border border-white/10 bg-ink-soft/40 p-4">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-1 text-xs text-ink-muted">{body}</p>
    </div>
  );
}

function PortalTourRow({
  tour,
  bookings,
}: {
  tour: IGuideListItem;
  bookings: Array<{ id: string; label: string }>;
}) {
  return (
    <li className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="grid gap-3 md:grid-cols-[1fr_minmax(260px,420px)]">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">
            {tour.address || tour.alias || tour.id}
          </p>
          <p className="mt-1 truncate text-xs text-ink-muted">
            Portal ID:{" "}
            <code className="rounded bg-black/30 px-1 py-0.5 text-[11px] text-white/90">
              {tour.id}
            </code>
            {tour.alias ? ` · ${tour.alias}` : ""}
            {tour.status ? ` · ${tour.status}` : ""}
          </p>
          {tour.manageUrl ? (
            <a
              href={tour.manageUrl}
              target="_blank"
              rel="noopener"
              className="mt-1 inline-block text-xs text-brand-light underline"
            >
              Open in iGUIDE
            </a>
          ) : null}
        </div>
        <form action={linkIGuidePortalTour} className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input type="hidden" name="portal_id" value={tour.id} />
          <input type="hidden" name="alias" value={tour.alias ?? ""} />
          <select
            name="booking_id"
            required
            className="min-w-0 rounded-xl border border-white/10 bg-ink-soft px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-light/60"
            defaultValue=""
          >
            <option value="" disabled>
              Pick booking
            </option>
            {bookings.map((booking) => (
              <option key={booking.id} value={booking.id}>
                {booking.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-full bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-light"
          >
            Link + sync
          </button>
        </form>
      </div>
    </li>
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
  const address = formatBookingAddress(booking);
  const realtor = booking.profiles?.full_name ?? booking.profiles?.email ?? "No realtor";
  const date = formatBookingDate(booking.scheduled_at);
  return `${address || "No address"} - ${realtor} - ${date}`;
}

function formatBookingAddress(booking: BookingOptionRow): string {
  return (
    [
      booking.properties?.street_address,
      booking.properties?.city,
      booking.properties?.postal_code,
    ]
      .filter(Boolean)
      .join(", ") || "No address"
  );
}

function formatBookingDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "No date";
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

function filterPortalTours(
  tours: IGuideListItem[],
  query: string,
): IGuideListItem[] {
  if (!query) return tours;
  const q = normalizeAddress(query);
  return tours.filter((tour) =>
    normalizeAddress(
      [tour.id, tour.alias, tour.address, tour.status].filter(Boolean).join(" "),
    ).includes(q),
  );
}
