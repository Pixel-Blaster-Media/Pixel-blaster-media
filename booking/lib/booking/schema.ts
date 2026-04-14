/**
 * Shape + validation for booking_request submissions.
 *
 * Validation is intentionally hand-rolled (no zod / yup) to keep the
 * dependency surface tight in Phase 2. If validation gets more complex in
 * later phases, swap to zod and export inferred types from the schema.
 */

import {
  isValidAddOnId,
  isValidServiceId,
  PREFERRED_TIMES,
  type PreferredTime,
} from "./services";

export interface BookingRequestInput {
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  brokerage?: string;
  street_address: string;
  city?: string;
  postal_code?: string;
  square_footage?: number;
  services: string[];
  add_ons: string[];
  preferred_date?: string; // ISO date (yyyy-mm-dd)
  preferred_time?: PreferredTime;
  notes?: string;
}

export type ValidationErrors = Partial<
  Record<keyof BookingRequestInput | "_form", string>
>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PREFERRED_TIME_IDS = new Set(PREFERRED_TIMES.map((p) => p.id));

export function validateBookingRequest(
  input: BookingRequestInput,
): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!input.contact_name?.trim()) {
    errors.contact_name = "Please tell us your name.";
  }

  if (!input.contact_email?.trim()) {
    errors.contact_email = "We need an email to confirm your booking.";
  } else if (!EMAIL_RE.test(input.contact_email.trim())) {
    errors.contact_email = "That email doesn't look right.";
  }

  if (!input.street_address?.trim()) {
    errors.street_address = "Property address is required.";
  }

  if (!Array.isArray(input.services) || input.services.length === 0) {
    errors.services = "Pick at least one service.";
  } else if (!input.services.every(isValidServiceId)) {
    errors.services = "One of the selected services isn't recognized.";
  }

  if (input.add_ons && !input.add_ons.every(isValidAddOnId)) {
    errors.add_ons = "One of the selected add-ons isn't recognized.";
  }

  if (
    input.preferred_time &&
    !PREFERRED_TIME_IDS.has(input.preferred_time)
  ) {
    errors.preferred_time = "Pick a valid time window.";
  }

  if (input.preferred_date) {
    const d = new Date(input.preferred_date);
    if (Number.isNaN(d.getTime())) {
      errors.preferred_date = "Pick a valid date.";
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (d < today) {
        errors.preferred_date = "Date can't be in the past.";
      }
    }
  }

  if (
    input.square_footage !== undefined &&
    input.square_footage !== null &&
    (!Number.isInteger(input.square_footage) || input.square_footage < 0)
  ) {
    errors.square_footage = "Square footage must be a whole number.";
  }

  return errors;
}

export interface BookingActionResult {
  ok: boolean;
  /** Present when ok === false. */
  errors?: ValidationErrors;
  /** Present when ok === true. */
  requestId?: string;
}
