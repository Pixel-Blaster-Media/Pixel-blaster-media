"use server";

import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { saveBookingWizardDraft } from "@/app/book/draft-actions";

export type RebookResult = { error: string } | null;
type RebookProperty = { street_address: string; city: string | null; postal_code: string | null };
type RebookBooking = { id: string; services: string[]; add_ons: string[]; square_footage: number | null; unit_number: string | null };

/** A POST creates the private draft only after resolving the current owner and
 * company. Neither the link nor hidden inputs carry property/access details. */
export async function startSimilarBooking(_previous: RebookResult, formData: FormData): Promise<RebookResult> {
  const user = await requireUser("/portal/book");
  const propertyId = String(formData.get("property_id") ?? "");
  const bookingId = String(formData.get("booking_id") ?? "");
  if (user.role !== "realtor" || !/^[0-9a-f-]{36}$/.test(propertyId) ||
      (bookingId && !/^[0-9a-f-]{36}$/.test(bookingId))) notFound();
  const client = await getServerSupabase();
  const { data: property, error: propertyError } = await client.from("properties")
    .select("street_address, city, postal_code")
    .eq("id", propertyId).eq("organization_id", user.organizationId).eq("owner_id", user.userId).maybeSingle<RebookProperty>();
  if (propertyError || !property) notFound();
  let bookingQuery = client.from("bookings").select("id, services, add_ons, square_footage, unit_number")
    .eq("property_id", propertyId).eq("organization_id", user.organizationId).eq("owner_id", user.userId);
  if (bookingId) bookingQuery = bookingQuery.eq("id", bookingId);
  const { data: booking, error: bookingError } = await bookingQuery.order("created_at", { ascending: false }).limit(1).maybeSingle<RebookBooking>();
  if (bookingError || (bookingId && !booking)) notFound();
  const { data: organization, error: orgError } = await getServiceSupabase().from("organizations")
    .select("slug").eq("id", user.organizationId).maybeSingle();
  if (orgError || !organization?.slug) return { error: "This booking company is unavailable. Please try again later." };
  const query = new URLSearchParams({ org: organization.slug });
  if (booking?.services.length) query.set("services", booking.services.join(","));
  if (booking?.add_ons.length) query.set("add_ons", booking.add_ons.join(","));
  const saved = await saveBookingWizardDraft({ query: query.toString(), property: {
    streetAddress: property.street_address, city: property.city ?? "", postalCode: property.postal_code ?? "",
    unitNumber: booking?.unit_number ?? "", squareFootage: booking?.square_footage ?? null,
    // Occupancy, basement selection and access instructions need a fresh review.
    isVacant: null, includeBasement: null, shotRequests: [], shootNotes: "",
  } });
  if (!saved.ok) return { error: saved.error };
  redirect(`${booking?.services.length ? "/book/property" : "/book"}?${saved.query}`);
}
