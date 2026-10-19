/** A rolling elapsed-time rule: never a local-calendar-day calculation. */
export const CUSTOMER_BOOKING_NOTICE_MS = 24 * 60 * 60 * 1000;
export const CUSTOMER_BOOKING_NOTICE_MESSAGE =
  "Please choose a shoot time at least 24 hours from now. Contact the studio if you need an earlier appointment.";
export const BOOKING_AVAILABILITY_ERROR =
  "Availability is temporarily unavailable. Please try again.";

export function meetsCustomerBookingNotice(start: Date, now: Date): boolean {
  return Number.isFinite(start.getTime()) && Number.isFinite(now.getTime()) &&
    start.getTime() >= now.getTime() + CUSTOMER_BOOKING_NOTICE_MS;
}
