"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/require-user";
import { getServiceSupabase } from "@/lib/supabase/server";

export interface PortalActionResult {
  ok: boolean;
  error?: string;
}

export async function archiveProperty(
  propertyId: string,
): Promise<PortalActionResult> {
  return setPropertyArchived(propertyId, true);
}

export async function restoreProperty(
  propertyId: string,
): Promise<PortalActionResult> {
  return setPropertyArchived(propertyId, false);
}

async function setPropertyArchived(
  propertyId: string,
  archived: boolean,
): Promise<PortalActionResult> {
  const user = await requireUser("/portal");
  const service = getServiceSupabase();
  const { error } = await service
    .from("properties")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", propertyId)
    .eq("owner_id", user.userId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/portal");
  revalidatePath(`/portal/${propertyId}`);
  return { ok: true };
}
