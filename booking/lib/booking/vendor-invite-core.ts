import { createHash } from "node:crypto";
import type { BookingVendorInviteRow } from "@/lib/supabase/database.types";
import type { GoogleCalendarMutationInput } from "@/lib/integrations/google-calendar/event-mutation-core";

export interface VendorContact { email: string; name: string; logo_url: string | null }
export interface VendorInput extends VendorContact { instructions: string; save: boolean }
export interface VendorSchedule {
  status: string;
  scheduled_at: string | null;
  scheduled_ends_at: string | null;
  unit_number: string | null;
  properties: { street_address: string; city: string | null; province: string | null } | null;
}

function field(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export function readVendorInput(form: FormData): VendorInput | null {
  const email = field(form, "vendor_email").toLowerCase();
  const name = field(form, "vendor_name");
  const logo = field(form, "vendor_logo_url");
  const instructions = field(form, "vendor_instructions");
  const save = form.get("vendor_save_contact") === "on";
  if (!email && !name && !logo && !instructions && !save) return null;
  if (email.length > 254 || !/^[^\s@<>,;]+@[^\s@<>,;.]+(?:\.[^\s@<>,;.]+)+$/.test(email)) {
    throw new Error("Enter one valid vendor email.");
  }
  if (name.length > 100 || instructions.length > 1500) throw new Error("Shorten the vendor name or instructions.");
  let logo_url = null;
  if (logo) {
    try {
      const url = new URL(logo);
      if (url.protocol !== "https:" || url.username || url.password || url.href.length > 1000) throw new Error();
      logo_url = url.href;
    } catch {
      throw new Error("Use a direct HTTPS link for the vendor logo.");
    }
  }
  return { email, name, logo_url, instructions, save };
}

export function vendorEventId(id: string) {
  return "pbv" + createHash("sha256").update(id).digest("hex");
}

export function vendorEventInput(booking: VendorSchedule, vendor: BookingVendorInviteRow): GoogleCalendarMutationInput | null {
  if (vendor.removed || booking.status === "cancelled" || !booking.scheduled_at || !booking.scheduled_ends_at) return null;
  const p = booking.properties;
  const address = [
    [p?.street_address, booking.unit_number ? `Unit ${booking.unit_number}` : null].filter(Boolean).join(", "),
    p?.city, p?.province,
  ].filter(Boolean).join(", ");
  // Allowlisted projection only: no realtor details, links, prices, or general booking notes.
  return {
    summary: "Vendor shoot",
    location: address,
    description: vendor.instructions.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>"),
    startISO: booking.scheduled_at,
    endISO: booking.scheduled_ends_at,
    attendeeEmail: vendor.email,
    attendeeName: vendor.name || undefined,
    bookingId: vendor.id,
    organizationId: vendor.organization_id,
    vendorInvite: true,
  };
}

export function vendorFingerprint(input: GoogleCalendarMutationInput | null) {
  return input ? createHash("sha256").update(JSON.stringify(input)).digest("hex") : "cancelled";
}
