import "server-only";

import { syncStoredBookingGoogleCalendarEvent } from "@/lib/booking/calendar-event-service";
import { getServiceSupabase } from "@/lib/supabase/server";

const FANOUT_PAGE_SIZE = 200;
const FANOUT_CONCURRENCY = 5;

interface RealtorBookingRow {
  id: string;
}

export async function syncRealtorCalendarEventsBestEffort(args: {
  organizationId: string;
  ownerId: string;
  excludeBookingId?: string;
}): Promise<boolean> {
  const service = getServiceSupabase();
  let cursor: string | null = null;
  let allSynced = true;

  while (true) {
    let query = service
      .from("bookings")
      .select("id")
      .eq("organization_id", args.organizationId)
      .eq("owner_id", args.ownerId)
      .neq("status", "cancelled")
      .not("scheduled_at", "is", null)
      .not("scheduled_ends_at", "is", null)
      .order("id", { ascending: true })
      .limit(FANOUT_PAGE_SIZE);

    if (cursor) query = query.gt("id", cursor);

    const { data, error } = await query;
    if (error) {
      console.warn("[calendar] linked realtor booking lookup failed");
      return false;
    }

    const page = (data ?? []) as RealtorBookingRow[];
    const bookingIds = page
      .map((booking) => booking.id)
      .filter((bookingId) => bookingId !== args.excludeBookingId);

    for (let index = 0; index < bookingIds.length; index += FANOUT_CONCURRENCY) {
      const results = await Promise.all(
        bookingIds
          .slice(index, index + FANOUT_CONCURRENCY)
          .map(async (bookingId) => {
            try {
              const result = await syncStoredBookingGoogleCalendarEvent({
                organizationId: args.organizationId,
                bookingId,
              });
              return result.ok;
            } catch {
              return false;
            }
          }),
      );
      if (results.some((result) => !result)) allSynced = false;
    }

    if (page.length < FANOUT_PAGE_SIZE) break;
    cursor = page.at(-1)?.id ?? null;
    if (!cursor) break;
  }

  return allSynced;
}
