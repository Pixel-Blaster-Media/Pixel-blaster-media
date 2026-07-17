import "server-only";

import { randomUUID } from "node:crypto";

import type { getServiceSupabase } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof getServiceSupabase>;

export type ProvisionRealtorResult =
  | {
      ok: true;
      userId: string;
      provisioningId: string;
    }
  | {
      ok: false;
      reference: string;
      message: string;
    };

/**
 * Create a tenant-bound realtor Auth identity and recover an accepted but
 * unacknowledged Auth request by its per-attempt marker. This function never
 * reports an ordinary retryable failure while the Auth commit is unresolved.
 */
export async function provisionRealtorAuthUser({
  service,
  email,
  fullName,
  password,
  organizationId,
  context,
}: {
  service: ServiceClient;
  email: string;
  fullName: string;
  password?: string;
  organizationId: string;
  context: string;
}): Promise<ProvisionRealtorResult> {
  const provisioningId = randomUUID();
  const reference = provisioningId;
  let failureMessage = "Auth creation did not return a user.";

  try {
    try {
      const created = await service.auth.admin.createUser({
        email,
        ...(password ? { password } : {}),
        email_confirm: true,
        user_metadata: { full_name: fullName },
        app_metadata: {
          realtor_organization_id: organizationId,
          realtor_provisioning_id: provisioningId,
        },
      });
      if (created.data.user) {
        return { ok: true, userId: created.data.user.id, provisioningId };
      }
      if (created.error) failureMessage = created.error.message;
    } catch (error) {
      failureMessage =
        error instanceof Error ? error.message : "Auth creation response was lost.";
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500));
      const recovered = await service.rpc("find_realtor_provisioning_auth_user", {
        p_provisioning_id: provisioningId,
        p_organization_id: organizationId,
      });
      if (isUuid(recovered.data)) {
        return { ok: true, userId: recovered.data, provisioningId };
      }
      if (recovered.error) {
        failureMessage = recovered.error.message;
        break;
      }
    }
  } catch (error) {
    failureMessage =
      error instanceof Error ? error.message : "Provisioning recovery transport failed.";
  }

  const message =
    "Account creation could not be confirmed. Do not retry. Email info@pixelblastermedia.com and include this reference.";
  try {
    const recorded = await service.from("provisioning_cleanup_events").insert({
      id: reference,
      auth_user_id: null,
      provisioning_id: provisioningId,
      status: "failed",
      context,
      detail: failureMessage,
    });
    if (recorded.error) {
      console.error("[auth] unresolved provisioning event persistence failed", reference, recorded.error.code);
    }
  } catch (recordError) {
    console.error(
      "[auth] unresolved provisioning event persistence threw",
      reference,
      recordError instanceof Error ? recordError.message : "unknown error",
    );
  }
  console.error("[auth] realtor provisioning unresolved", reference, provisioningId);
  return { ok: false, reference, message };
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
