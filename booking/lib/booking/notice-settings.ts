import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";
import {
  BOOKING_AVAILABILITY_ERROR,
  CUSTOMER_BOOKING_NOTICE_MESSAGE,
  meetsCustomerBookingNotice,
} from "./notice-policy";

/** Read fresh for every request. A missing migration/read failure must not disable the rule. */
export async function requiresCustomerBookingNotice(organizationId: string): Promise<boolean> {
  const { data, error } = await getServiceSupabase()
    .from("organizations")
    .select("require_24_hour_notice")
    .eq("id", organizationId)
    .maybeSingle<{ require_24_hour_notice: boolean }>();
  if (error || typeof data?.require_24_hour_notice !== "boolean") {
    throw new Error(BOOKING_AVAILABILITY_ERROR);
  }
  return data.require_24_hour_notice;
}

/** Run before auth provisioning or notification work; the DB also checks at the write. */
export async function customerBookingNoticeError(start: Date, organizationId: string): Promise<string | null> {
  try {
    const required = await requiresCustomerBookingNotice(organizationId);
    return required && !meetsCustomerBookingNotice(start, new Date())
      ? CUSTOMER_BOOKING_NOTICE_MESSAGE : null;
  } catch {
    return BOOKING_AVAILABILITY_ERROR;
  }
}
