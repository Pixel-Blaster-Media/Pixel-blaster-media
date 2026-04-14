"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { isValidAddOnId, isValidServiceId } from "@/lib/booking/services";
import { getServiceSupabase } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Persist one row of the pricing table. The admin UI edits each row
 * independently so we don't need a batch update.
 */
export async function savePrice(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();

  const serviceId = ((formData.get("service_id") as string | null) ?? "").trim();
  const dollars = ((formData.get("price_dollars") as string | null) ?? "").trim();
  const taxable = formData.get("taxable") === "on";

  if (!serviceId || (!isValidServiceId(serviceId) && !isValidAddOnId(serviceId))) {
    return { ok: false, error: "Invalid service id." };
  }

  const parsed = Number(dollars);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, error: "Price must be 0 or more." };
  }
  const cents = Math.round(parsed * 100);

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("service_prices")
    .upsert(
      {
        service_id: serviceId,
        price_cents: cents,
        taxable,
        updated_by: admin.userId,
      },
      { onConflict: "service_id" },
    );

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/settings/pricing");
  return { ok: true };
}
