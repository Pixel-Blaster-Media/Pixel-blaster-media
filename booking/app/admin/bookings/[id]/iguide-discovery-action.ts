"use server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { getPostShootIGuideStage } from "@/lib/integrations/iguide/post-shoot-discovery";

export async function readPostShootIGuideStage(bookingId: string) {
  if (process.env.IGUIDE_POST_SHOOT_DISCOVERY_ENABLED !== "true") return null;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(bookingId)) return null;
  const admin = await requireAdmin();
  return getPostShootIGuideStage(admin.organizationId, bookingId);
}
