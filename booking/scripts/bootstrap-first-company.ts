import { randomBytes, randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd(), false);

const DEFAULT_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  const required = {
    companyName: process.env.BOOTSTRAP_COMPANY_NAME?.trim(),
    slug: process.env.BOOTSTRAP_COMPANY_SLUG?.trim(),
    ownerName: process.env.BOOTSTRAP_OWNER_NAME?.trim(),
    ownerEmail: process.env.BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase(),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, ""),
    resendKey: process.env.RESEND_API_KEY?.trim(),
    emailFrom: process.env.EMAIL_FROM?.trim(),
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`Missing bootstrap values: ${missing.join(", ")}`);
  }

  const service = createClient(required.supabaseUrl!, required.serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [privileged, profiles, organization] = await Promise.all([
    service
      .from("organization_members")
      .select("profile_id", { count: "exact", head: true })
      .in("role", ["owner", "admin"]),
    service.from("profiles").select("id", { count: "exact", head: true }),
    service
      .from("organizations")
      .select("id")
      .eq("id", DEFAULT_ORGANIZATION_ID)
      .maybeSingle<{ id: string }>(),
  ]);
  if (privileged.error || profiles.error || organization.error) {
    throw new Error(
      privileged.error?.message ??
        profiles.error?.message ??
        organization.error?.message ??
        "Bootstrap preflight failed.",
    );
  }
  if ((privileged.count ?? 0) > 0 || (profiles.count ?? 0) > 0) {
    throw new Error(
      "Bootstrap refused: an account or privileged company membership already exists.",
    );
  }
  if (!organization.data) {
    throw new Error("Bootstrap refused: the default organization is missing.");
  }

  const invitationId =
    process.env.BOOTSTRAP_INVITATION_ID?.trim() || randomUUID();
  let userId: string | null = null;
  let creationMessage = "Owner Auth creation did not return a user.";
  let stateCommitted = false;
  let preserveIdentity = false;
  let authCreateAmbiguous = false;
  let recoveryInstruction = `Retry with BOOTSTRAP_INVITATION_ID=${invitationId}.`;
  try {
    try {
      const created = await service.auth.admin.createUser({
        email: required.ownerEmail!,
        email_confirm: false,
        user_metadata: { full_name: required.ownerName! },
        app_metadata: { company_invitation_id: invitationId },
      });
      userId = created.data.user?.id ?? null;
      if (created.error) creationMessage = created.error.message;
    } catch (error) {
      authCreateAmbiguous = true;
      creationMessage =
        error instanceof Error ? error.message : "Auth creation response was lost.";
    }

    // A timed-out createUser request may still have committed. Recover by the
    // stable marker before deciding whether cleanup or a retry is needed.
    for (let attempt = 0; !userId && attempt < 4; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500));
      const recovered = await service.rpc("find_company_invitation_auth_user", {
        p_invitation_id: invitationId,
      });
      if (recovered.error) {
        preserveIdentity = true;
        throw new Error(
          `${recovered.error.message} Preserve the identity and retry with BOOTSTRAP_INVITATION_ID=${invitationId}.`,
        );
      }
      if (recovered.data !== null && !isUuid(recovered.data)) {
        preserveIdentity = true;
        throw new Error(
          `Marker recovery returned an invalid Auth ID. Preserve the identity and retry with BOOTSTRAP_INVITATION_ID=${invitationId}.`,
        );
      }
      userId = isUuid(recovered.data) ? recovered.data : null;
    }
    if (!userId) {
      preserveIdentity = authCreateAmbiguous;
      throw new Error(
        `${creationMessage} Retry with BOOTSTRAP_INVITATION_ID=${invitationId} so an accepted-but-unacknowledged Auth user can be recovered.`,
      );
    }

    const primaryColor = process.env.BOOTSTRAP_PRIMARY_COLOR?.trim() || "#3f7f5f";
    const accentColor = process.env.BOOTSTRAP_ACCENT_COLOR?.trim() || "#c9a35b";
    let claimMessage = "First-owner database claim was not confirmed.";
    let claimOutcome: "success" | "error" | "thrown" = "success";
    recoveryInstruction =
      `Do not rerun bootstrap. Reconcile the Auth user and database state using BOOTSTRAP_INVITATION_ID=${invitationId}.`;
    try {
      const claimed = await service.rpc("bootstrap_first_company_owner", {
        p_invitation_id: invitationId,
        p_user_id: userId,
        p_email: required.ownerEmail!,
        p_full_name: required.ownerName!,
        p_company_name: required.companyName!,
        p_company_slug: required.slug!,
        p_primary_color: primaryColor,
        p_accent_color: accentColor,
      });
      if (claimed.error) {
        claimOutcome = "error";
        claimMessage = claimed.error.message;
      }
    } catch (error) {
      claimOutcome = "thrown";
      claimMessage =
        error instanceof Error ? error.message : "Database claim response was lost.";
    }

    preserveIdentity = true;
    const [claimedProfile, claimedMembership, claimedOrganization] = await Promise.all([
      service
        .from("profiles")
        .select("id")
        .eq("id", userId)
        .eq("organization_id", DEFAULT_ORGANIZATION_ID)
        .eq("role", "admin")
        .maybeSingle(),
      service
        .from("organization_members")
        .select("profile_id")
        .eq("profile_id", userId)
        .eq("organization_id", DEFAULT_ORGANIZATION_ID)
        .eq("role", "owner")
        .maybeSingle(),
      service
        .from("organizations")
        .select("id")
        .eq("id", DEFAULT_ORGANIZATION_ID)
        .eq("name", required.companyName!)
        .eq("slug", required.slug!)
        .eq("primary_color", primaryColor)
        .eq("accent_color", accentColor)
        .maybeSingle(),
    ]);
    preserveIdentity = false;
    if (
      claimedProfile.error ||
      claimedMembership.error ||
      claimedOrganization.error
    ) {
      preserveIdentity = true;
      throw new Error(
        `${claimMessage} Post-claim verification is unresolved. ${recoveryInstruction}`,
      );
    }
    if (
      claimedProfile.data &&
      claimedMembership.data &&
      claimedOrganization.data
    ) {
      stateCommitted = true;
    } else if (
      claimOutcome === "error" &&
      !claimedProfile.data &&
      !claimedMembership.data
    ) {
      throw new Error(`${claimMessage} BOOTSTRAP_INVITATION_ID=${invitationId}`);
    } else {
      preserveIdentity = true;
      throw new Error(
        `${claimMessage} Partial or ambiguous state detected. ${recoveryInstruction}`,
      );
    }

    const resetUrl = new URL("/auth/reset", required.appUrl!);
    resetUrl.searchParams.set("email", required.ownerEmail!);
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${required.resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: required.emailFrom,
        to: [required.ownerEmail],
        subject: `Set up your ${required.companyName} owner account`,
        html: `<p>Hello ${escapeHtml(required.ownerName!)},</p><p>Your photography-company owner account is ready.</p><p><a href="${escapeHtml(resetUrl.toString())}">Verify your email and set your password</a></p><p>This link is for ${escapeHtml(required.ownerEmail!)} only.</p>`,
      }),
    });
    if (!emailResponse.ok) {
      throw new Error(`Owner setup email failed (${emailResponse.status}).`);
    }

    console.log(
      JSON.stringify({
        bootstrapped: true,
        company: required.companyName,
        ownerEmail: required.ownerEmail,
        setupEmailSent: true,
      }),
    );
  } catch (error) {
    if (stateCommitted) {
      throw new Error(
        `Owner workspace was committed, but setup email delivery was not confirmed. Keep the owner account and open ${required.appUrl}/auth/reset for ${required.ownerEmail}. Cause: ${error instanceof Error ? error.message : "unknown delivery failure"}`,
      );
    }
    if (preserveIdentity) {
      throw new Error(
        `Bootstrap state is unresolved. Preserve the identity. ${recoveryInstruction} Cause: ${error instanceof Error ? error.message : "unknown failure"}`,
      );
    }
    const cleanupErrors: string[] = [];
    if (userId) {
      const membershipCleanup = await service
        .from("organization_members")
        .delete()
        .eq("profile_id", userId);
      if (membershipCleanup.error) cleanupErrors.push(membershipCleanup.error.message);
      const authCleanup = await service.auth.admin.deleteUser(userId);
      if (authCleanup.error) cleanupErrors.push(authCleanup.error.message);
    }
    if (cleanupErrors.length) {
      throw new Error(
        `Bootstrap failed and cleanup needs manual attention: ${cleanupErrors.join("; ")}`,
      );
    }
    throw error;
  }
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Bootstrap failed.");
  process.exitCode = 1;
});
