"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { businessDateTimeLocalToUtc } from "@/lib/booking/availability";
import { getServiceSupabase } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Update one day's working hours. The admin UI edits a single row at
 * a time so the action is small; there's no whole-week save button.
 */
export async function saveBusinessHour(
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const dow = Number(formData.get("day_of_week"));
  const start = ((formData.get("start_time") as string | null) ?? "").trim();
  const end = ((formData.get("end_time") as string | null) ?? "").trim();
  const enabled = formData.get("enabled") === "on";

  if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
    return { ok: false, error: "Invalid day." };
  }
  if (
    !/^\d{2}:\d{2}(:\d{2})?$/.test(start) ||
    !/^\d{2}:\d{2}(:\d{2})?$/.test(end)
  ) {
    return { ok: false, error: "Times must be HH:MM." };
  }
  if (start >= end) {
    return { ok: false, error: "End time must be after start time." };
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("business_hours")
    .update({ start_time: start, end_time: end, enabled })
    .eq("organization_id", admin.organizationId)
    .eq("day_of_week", dow);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/settings/availability");
  return { ok: true };
}

/**
 * Add a one-off busy block (vacation, holiday, personal appt). Realtors
 * will see slots covered by this block as unavailable; the label never
 * reaches them.
 */
export async function addCalendarBlock(
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const starts = ((formData.get("starts_at") as string | null) ?? "").trim();
  const ends = ((formData.get("ends_at") as string | null) ?? "").trim();
  const label =
    ((formData.get("label") as string | null) ?? "").trim() || null;

  if (!starts || !ends) {
    return { ok: false, error: "Start and end are required." };
  }
  const startsDate = businessDateTimeLocalToUtc(starts);
  const endsDate = businessDateTimeLocalToUtc(ends);
  if (!startsDate || !endsDate) {
    return { ok: false, error: "Invalid dates." };
  }
  if (endsDate <= startsDate) {
    return { ok: false, error: "End must be after start." };
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase.from("calendar_blocks").insert({
    organization_id: admin.organizationId,
    starts_at: startsDate.toISOString(),
    ends_at: endsDate.toISOString(),
    label,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/settings/availability");
  revalidatePath("/admin/calendar");
  return { ok: true };
}

export async function deleteCalendarBlock(
  blockId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("calendar_blocks")
    .delete()
    .eq("organization_id", admin.organizationId)
    .eq("id", blockId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/settings/availability");
  revalidatePath("/admin/calendar");
  return { ok: true };
}

export async function updateCalendarBlock(
  blockId: string,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const starts = ((formData.get("starts_at") as string | null) ?? "").trim();
  const ends = ((formData.get("ends_at") as string | null) ?? "").trim();
  const label =
    ((formData.get("label") as string | null) ?? "").trim() || null;

  if (!blockId || !starts || !ends) {
    return { ok: false, error: "Start and end are required." };
  }

  const startsDate = businessDateTimeLocalToUtc(starts);
  const endsDate = businessDateTimeLocalToUtc(ends);
  if (!startsDate || !endsDate) {
    return { ok: false, error: "Invalid dates." };
  }
  if (endsDate <= startsDate) {
    return { ok: false, error: "End must be after start." };
  }

  const { data, error } = await getServiceSupabase()
    .from("calendar_blocks")
    .update({
      starts_at: startsDate.toISOString(),
      ends_at: endsDate.toISOString(),
      label,
    })
    .eq("organization_id", admin.organizationId)
    .eq("id", blockId)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Blocked time not found." };

  revalidatePath("/admin/settings/availability");
  revalidatePath("/admin/calendar");
  return { ok: true };
}
