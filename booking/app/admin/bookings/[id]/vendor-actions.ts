"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { readVendorInput } from "@/lib/booking/vendor-invite-core";
import { attachVendor, removeVendor, syncBookingVendorInvites } from "@/lib/booking/vendor-invite-server";

export async function changeBookingVendor(bookingId: string, operation: "add" | "remove" | "retry", form: FormData) {
  const admin = await requireAdmin();
  const scope = { organizationId: admin.organizationId, bookingId };
  try {
    let synced: boolean;
    let contactSaved = true;
    if (operation === "add") {
      const vendor = readVendorInput(form);
      if (!vendor) return { error: "Enter the vendor’s email." };
      ({ synced, contactSaved } = await attachVendor(scope, vendor));
    } else if (operation === "remove") {
      synced = await removeVendor(scope, String(form.get("vendor_id") ?? ""));
    } else if (operation === "retry") {
      synced = await syncBookingVendorInvites(scope);
    } else {
      return { error: "Unknown vendor action." };
    }
    return { error: [!synced && "The invite change is saved but hasn’t synced to Google Calendar. Retry from this booking.", !contactSaved && "The contact couldn’t be saved for future bookings."].filter(Boolean).join(" ") || null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not update the vendor." };
  } finally {
    revalidatePath(`/admin/bookings/${bookingId}`);
  }
}
