"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import type { InternalShootNotesMutationResult } from "@/lib/booking/internal-shoot-notes-core";
import { updateBookingInternalNotes } from "@/lib/booking/internal-shoot-notes-server";

export async function saveInternalShootNotes(
  bookingId: string,
  value: unknown,
  expectedRevision: unknown,
): Promise<InternalShootNotesMutationResult> {
  const admin = await requireAdmin();
  const result = await updateBookingInternalNotes({
    organizationId: admin.organizationId,
    bookingId,
    actorId: admin.userId,
    expectedRevision,
    value,
  });

  if (!result.ok) return result;

  revalidatePath("/admin/today");
  revalidatePath("/admin/calendar");
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${bookingId}`);
  return result;
}
