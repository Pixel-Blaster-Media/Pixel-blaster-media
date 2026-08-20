import "server-only";

import {
  loadBookingCalendarSelectionItemsCore,
  type BookingCalendarCatalogLabel,
  type BookingCalendarSelectionSnapshot,
} from "@/lib/booking/calendar-event-items-core";
import type { BookingCalendarSelectionItem } from "@/lib/booking/calendar-event-details";
import { labelForAddOn, labelForService } from "@/lib/booking/services";
import { getServiceSupabase } from "@/lib/supabase/server";

const LEGACY_BUNDLE_SLUGS = new Set([
  "blue_print",
  "social_media_special",
  "social_media_plus",
  "ultimate",
]);

export async function loadBookingCalendarSelectionItems(args: {
  organizationId: string;
  bookingId: string;
  services: readonly string[];
  addOns: readonly string[];
}): Promise<BookingCalendarSelectionItem[]> {
  const service = getServiceSupabase();

  return loadBookingCalendarSelectionItemsCore(args, {
    verifyBooking: async ({ organizationId, bookingId }) => {
      const { data, error } = await service
        .from("bookings")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("id", bookingId)
        .maybeSingle<{ id: string }>();
      return !error && Boolean(data);
    },
    loadSnapshots: async (bookingId) => {
      const { data, error } = await service
        .from("booking_line_items")
        .select("item_name, item_slug, item_kind")
        .eq("booking_id", bookingId)
        .returns<BookingCalendarSelectionSnapshot[]>();
      if (error) {
        throw new Error("Could not load booking calendar selections");
      }
      return data ?? [];
    },
    loadCatalog: async (organizationId) => {
      const { data, error } = await service
        .from("catalog_items")
        .select("slug, name, kind")
        .eq("organization_id", organizationId)
        .returns<BookingCalendarCatalogLabel[]>();
      if (error) throw new Error("Could not load booking Calendar catalog labels");
      return data ?? [];
    },
    legacyLabel: (slug, kind) =>
      kind === "addon" ? labelForAddOn(slug) : labelForService(slug),
    legacyServiceKind: (slug) =>
      LEGACY_BUNDLE_SLUGS.has(slug) ? "bundle" : "a_la_carte",
  });
}
