import "server-only";

import { randomUUID } from "node:crypto";

import { getServiceSupabase } from "@/lib/supabase/server";

export type ProvisionedRealtorRollbackStatus =
  | "deleted"
  | "quarantined"
  | "retained"
  | "failed";

export interface ProvisionedRealtorRollbackResult {
  status: ProvisionedRealtorRollbackStatus;
  reference: string | null;
}

/**
 * Remove authority from a realtor identity created by the current request.
 * The public wrapper converts every thrown setup, transport, and persistence
 * failure into a structured result; booking failure handling never throws.
 */
export async function rollbackProvisionedRealtor(args: {
  userId: string;
  provisioningId: string;
  context: string;
  propertyId?: string | null;
}): Promise<ProvisionedRealtorRollbackResult> {
  try {
    return await rollbackProvisionedRealtorInternal(args);
  } catch (error) {
    let reference: string | null = null;
    try {
      reference = randomUUID();
    } catch {
      // Crypto failure is extraordinarily rare; a null reference remains an
      // explicit failed status rather than escaping the cleanup boundary.
    }
    console.error(
      "[auth] provisioned realtor cleanup threw before reconciliation",
      reference,
      error instanceof Error ? error.message : "unknown error",
    );
    return { status: "failed", reference };
  }
}

async function rollbackProvisionedRealtorInternal({
  userId,
  provisioningId,
  context,
  propertyId = null,
}: {
  userId: string;
  provisioningId: string;
  context: string;
  propertyId?: string | null;
}): Promise<ProvisionedRealtorRollbackResult> {
  const service = getServiceSupabase();
  const reference = randomUUID();

  const finish = async (
    status: Exclude<ProvisionedRealtorRollbackStatus, "deleted">,
    detail: string,
    errorCode: string | null,
  ): Promise<ProvisionedRealtorRollbackResult> => {
    const combined = errorCode ? `${detail} (${errorCode})` : detail;
    try {
      const recorded = await service.from("provisioning_cleanup_events").insert({
        id: reference,
        auth_user_id: userId,
        provisioning_id: provisioningId,
        property_id: propertyId,
        status,
        context,
        detail: combined,
      });
      if (recorded.error) {
        console.error("[auth] cleanup event persistence failed", reference, recorded.error.code);
      }
    } catch (recordError) {
      console.error(
        "[auth] cleanup event persistence threw",
        reference,
        recordError instanceof Error ? recordError.message : "unknown error",
      );
    }
    console.error("[auth] provisioned realtor cleanup needs attention", reference, status);
    return { status, reference };
  };

  try {
    const quarantine = await service.rpc("quarantine_unbooked_realtor", {
      p_user_id: userId,
      p_property_id: propertyId,
      p_provisioning_id: provisioningId,
    });
    if (quarantine.error) {
      return finish(
        "failed",
        "database quarantine was unavailable; identity preserved",
        quarantine.error.code,
      );
    }
    if (quarantine.data === "retained") {
      return finish("retained", "identity marker mismatch or committed work exists", null);
    }
    if (quarantine.data !== "quarantined") {
      return finish("failed", "unexpected database quarantine result", null);
    }

    const authCleanup = await service.auth.admin.deleteUser(userId);
    if (!authCleanup.error) return { status: "deleted", reference: null };
    return finish(
      "quarantined",
      "database authority removed; Auth deletion needs retry",
      authCleanup.error.code ?? String(authCleanup.error.status ?? "auth_error"),
    );
  } catch (error) {
    return finish(
      "failed",
      "cleanup transport threw; identity state must be reconciled",
      error instanceof Error ? error.message : "unknown transport error",
    );
  }
}

export function rollbackNeedsOperatorAttention(
  result: ProvisionedRealtorRollbackResult,
): boolean {
  return result.status !== "deleted";
}
