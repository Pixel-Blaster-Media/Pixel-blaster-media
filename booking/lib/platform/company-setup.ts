import "server-only";

import { createHash, randomUUID } from "crypto";

import { emailHasAccount } from "@/lib/auth/email-lookup";
import { sendEmail } from "@/lib/email/resend";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { CatalogItemKind, Database } from "@/lib/supabase/database.types";

type CatalogItemRow = Database["public"]["Tables"]["catalog_items"]["Row"];
type CatalogItemInsert = Database["public"]["Tables"]["catalog_items"]["Insert"];

export interface CompanySetupInput {
  companyName: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  primaryColor: string;
  accentColor: string;
  copyCatalog: boolean;
  sourceCatalogOrganizationId?: string;
}

export interface ExistingUserCompanySetupInput {
  userId: string;
  companyName: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  primaryColor: string;
  accentColor: string;
  copyCatalog: boolean;
  sourceCatalogOrganizationId?: string;
}

export type InvitationCompanySetupInput = Omit<
  CompanySetupInput,
  "adminPassword"
> & {
  invitationId?: string;
  organizationId?: string;
  authProvisioningKey?: string;
};

export interface CompanySetupResult {
  ok: boolean;
  error?: string;
  warning?: string;
  companyName?: string;
  slug?: string;
  adminEmail?: string;
  bookingPath?: string;
  invitationSent?: boolean;
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function createCompanyWorkspace(
  input: CompanySetupInput,
): Promise<CompanySetupResult> {
  const service = getServiceSupabase();
  const validation = validateCompanySetupInput(input, { requirePassword: true });
  if (validation) return { ok: false, error: validation };

  const slugCheck = await ensureSlugAvailable(input.slug);
  if (slugCheck) return { ok: false, error: slugCheck };

  if (await emailHasAccount(input.adminEmail)) {
    return {
      ok: false,
      error:
        "That admin email already has an account. Use a fresh email for now; invitation-based multi-company access can come next.",
    };
  }

  let organization: { id: string; name: string; slug: string };
  try {
    organization = await createOrganization(input);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not create company.",
    };
  }

  let createdUserId: string | null = null;

  try {
    await seedStarterWorkspace(input, organization.id);

    const { data: created, error: createUserError } =
      await service.auth.admin.createUser({
        email: input.adminEmail,
        password: input.adminPassword,
        email_confirm: true,
        user_metadata: { full_name: input.adminName },
        app_metadata: { company_invitation_id: randomUUID() },
      });
    if (createUserError || !created.user) {
      throw new Error(createUserError?.message ?? "Could not create admin user.");
    }
    createdUserId = created.user.id;

    const { error: profileError } = await service.from("profiles").upsert({
      id: createdUserId,
      organization_id: organization.id,
      email: input.adminEmail,
      full_name: input.adminName,
      role: "admin",
    });
    if (profileError) throw new Error(profileError.message);

    const { error: memberError } = await service
      .from("organization_members")
      .upsert({
        organization_id: organization.id,
        profile_id: createdUserId,
        role: "owner",
      });
    if (memberError) throw new Error(memberError.message);
  } catch (err) {
    const cleanupError = await cleanupFailedCompany(
      organization.id,
      createdUserId,
    );
    const originalError =
      err instanceof Error ? err.message : "Company setup failed.";
    return {
      ok: false,
      error: cleanupError
        ? `${originalError} Automatic cleanup failed: ${cleanupError}`
        : originalError,
    };
  }

  return {
    ok: true,
    companyName: organization.name,
    slug: organization.slug,
    adminEmail: input.adminEmail,
    bookingPath: `/book?org=${organization.slug}`,
  };
}

export async function createCompanyWorkspaceWithInvitation(
  input: InvitationCompanySetupInput,
): Promise<CompanySetupResult> {
  const service = getServiceSupabase();
  const validation = validateCompanySetupInput(input, { requirePassword: false });
  if (validation) return { ok: false, error: validation };

  const appUrl = normalizedAppUrl();
  if (!appUrl) {
    return { ok: false, error: "Company invitations are not configured." };
  }

  if ((input.invitationId && !input.organizationId) || (!input.invitationId && input.organizationId)) {
    return { ok: false, error: "Incomplete company invitation recovery state." };
  }
  const recoveryIds = input.invitationId && input.organizationId
    ? { invitationId: input.invitationId, organizationId: input.organizationId }
    : invitationRecoveryIds(input.adminEmail);
  const { invitationId, organizationId } = recoveryIds;
  const recoveryReference = invitationId.slice(0, 8);

  const slugCheck = await ensureSlugAvailable(input.slug, organizationId);
  if (slugCheck) return { ok: false, error: slugCheck };

  // Recover a prior accepted-but-response-lost attempt before mutating Auth.
  // A found marker is safe to resume because only service-role code can set it.
  let recovery = await recoverInvitationAuthUser(invitationId);
  if (recovery.status === "unresolved") {
    return {
      ok: false,
      error: `Invitation recovery is temporarily unavailable. Retry the same email and company handle (reference ${recoveryReference}).`,
    };
  }

  let createdUserId: string;
  if (recovery.status === "found") {
    createdUserId = recovery.userId;
  } else {
    let created;
    let createUserError;
    try {
      const result = await service.auth.admin.createUser({
        email: input.adminEmail,
        email_confirm: false,
        user_metadata: {
          full_name: input.adminName,
          ...(input.authProvisioningKey
            ? { beta_provisioning_key: input.authProvisioningKey }
            : {}),
        },
        app_metadata: { company_invitation_id: invitationId },
      });
      created = result.data;
      createUserError = result.error;
    } catch {
      created = { user: null };
      createUserError = new Error("Auth creation response was unavailable.");
    }

    if (createUserError || !created.user) {
      recovery = await recoverInvitationAuthUser(invitationId, {
        waitForCommit: true,
      });
      if (recovery.status === "unresolved") {
        return {
          ok: false,
          error: `Invitation account state is unresolved. Retry the same email and company handle (reference ${recoveryReference}).`,
        };
      }
      if (recovery.status === "found") {
        createdUserId = recovery.userId;
      } else {
        return {
          ok: false,
          error: createUserError
            ? "That email already has an account or could not be invited."
            : "Could not create owner invitation.",
        };
      }
    } else {
      createdUserId = created.user.id;
    }
  }

  let organization: { id: string; name: string; slug: string } | null = null;
  try {
    organization = await createOrganization(input, organizationId);
    await seedStarterWorkspace(input, organization.id, { idempotent: true });

    const invitationUrl = new URL("/auth/magic", appUrl);
    invitationUrl.searchParams.set("audience", "company");
    invitationUrl.searchParams.set(
      "next",
      "/admin/settings/business?welcome=1",
    );

    const { error: claimError } = await service.rpc(
      "claim_company_invitation_owner",
      {
        p_invitation_id: invitationId,
        p_user_id: createdUserId,
        p_organization_id: organization.id,
        p_email: input.adminEmail,
        p_full_name: input.adminName,
      },
    );
    if (claimError) throw new Error(claimError.message);

    const invitation = await sendEmail({
      to: input.adminEmail,
      subject: `You are invited to ${organization.name}`,
      html: companyOwnerInvitationHtml({
        adminName: input.adminName,
        companyName: organization.name,
        actionLink: invitationUrl.toString(),
      }),
      organizationId: DEFAULT_ORGANIZATION_ID,
      idempotencyKey: `company-owner-invite:${invitationId}`,
    });
    if (!invitation.ok || invitation.skipped) {
      // A mail provider may accept a message while its response is lost. Keep
      // the valid company and account so a possibly delivered link never dies.
      return {
        ok: true,
        companyName: organization.name,
        slug: organization.slug,
        adminEmail: input.adminEmail,
        bookingPath: `/book?org=${organization.slug}`,
        invitationSent: false,
        warning:
          "The company was created, but invitation delivery could not be confirmed. Ask the owner to use email sign-in.",
      };
    }
  } catch (err) {
    const originalError =
      err instanceof Error ? err.message : "Company invitation failed.";
    return {
      ok: false,
      error: `${originalError} Review the error and retry this owner email (reference ${recoveryReference}).`,
    };
  }

  return {
    ok: true,
    companyName: organization.name,
    slug: organization.slug,
    adminEmail: input.adminEmail,
    bookingPath: `/book?org=${organization.slug}`,
    invitationSent: true,
  };
}

export async function createCompanyWorkspaceForExistingUser(
  input: ExistingUserCompanySetupInput,
): Promise<CompanySetupResult> {
  const service = getServiceSupabase();
  const validation = validateCompanySetupInput(input, { requirePassword: false });
  if (validation) return { ok: false, error: validation };
  if (!input.userId) return { ok: false, error: "Missing signed-in user." };

  const slugCheck = await ensureSlugAvailable(input.slug);
  if (slugCheck) return { ok: false, error: slugCheck };

  let organization: { id: string; name: string; slug: string };
  try {
    organization = await createOrganization(input);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not create company.",
    };
  }

  try {
    await seedStarterWorkspace(input, organization.id);

    const { error: profileError } = await service.from("profiles").upsert({
      id: input.userId,
      organization_id: organization.id,
      email: input.adminEmail,
      full_name: input.adminName,
      role: "admin",
    });
    if (profileError) throw new Error(profileError.message);

    const { error: memberError } = await service
      .from("organization_members")
      .upsert({
        organization_id: organization.id,
        profile_id: input.userId,
        role: "owner",
      });
    if (memberError) throw new Error(memberError.message);
  } catch (err) {
    const cleanupError = await cleanupFailedCompany(organization.id, null);
    const originalError =
      err instanceof Error ? err.message : "Company setup failed.";
    return {
      ok: false,
      error: cleanupError
        ? `${originalError} Automatic cleanup failed: ${cleanupError}`
        : originalError,
    };
  }

  return {
    ok: true,
    companyName: organization.name,
    slug: organization.slug,
    adminEmail: input.adminEmail,
    bookingPath: `/book?org=${organization.slug}`,
  };
}

export function cleanText(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeCompanySlug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function validateCompanySetupInput(
  input: CompanySetupInput | ExistingUserCompanySetupInput | InvitationCompanySetupInput,
  options: { requirePassword: boolean },
): string | null {
  if (!input.companyName) return "Company name is required.";
  if (input.companyName.length > 80) return "Company name is too long.";
  if (!input.slug || !SLUG_RE.test(input.slug)) {
    return "Use a simple company handle like forest-media.";
  }
  if (!input.adminName) return "First admin name is required.";
  if (!input.adminEmail.includes("@")) return "First admin email is invalid.";
  if (
    options.requirePassword &&
    "adminPassword" in input &&
    input.adminPassword.length < 10
  ) {
    return "Temporary password must be at least 10 characters.";
  }
  if (!HEX_COLOR_RE.test(input.primaryColor)) return "Primary color is invalid.";
  if (!HEX_COLOR_RE.test(input.accentColor)) return "Accent color is invalid.";
  return null;
}

function normalizedAppUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function companyOwnerInvitationHtml(input: {
  adminName: string;
  companyName: string;
  actionLink: string;
}): string {
  const name = escapeHtml(input.adminName);
  const company = escapeHtml(input.companyName);
  const link = escapeHtml(input.actionLink);
  return `<p>Hi ${name},</p><p>Your private ${company} booking workspace is ready.</p><p><a href="${link}">Open company sign-in</a></p><p>Enter this invited email address to request a fresh one-time sign-in link. Your workspace stays private until the platform owner activates its customer booking page.</p>`;
}

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

async function ensureSlugAvailable(
  slug: string,
  allowedOrganizationId?: string,
): Promise<string | null> {
  const service = getServiceSupabase();
  const { data: existingOrg, error: slugError } = await service
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle<{ id: string }>();
  if (slugError) return slugError.message;
  if (existingOrg && existingOrg.id !== allowedOrganizationId) {
    return "That company handle is already taken.";
  }
  return null;
}

async function createOrganization(
  input: CompanySetupInput | ExistingUserCompanySetupInput | InvitationCompanySetupInput,
  organizationId?: string,
): Promise<{ id: string; name: string; slug: string }> {
  const service = getServiceSupabase();
  if (organizationId) {
    const { data: existingOrganization, error: existingError } = await service
      .from("organizations")
      .select("id, name, slug")
      .eq("id", organizationId)
      .maybeSingle<{ id: string; name: string; slug: string }>();
    if (existingError) throw new Error(existingError.message);
    if (existingOrganization) {
      if (existingOrganization.slug !== input.slug) {
        throw new Error(
          "That owner email is already associated with another company invitation.",
        );
      }
      return existingOrganization;
    }
  }

  const values = {
    ...(organizationId ? { id: organizationId } : {}),
    name: input.companyName,
    slug: input.slug,
    primary_color: input.primaryColor,
    accent_color: input.accentColor,
    email_from_name: input.companyName,
    reply_to_email: input.adminEmail,
    admin_notification_email: input.adminEmail,
  };
  const { data: organization, error: orgError } = await service
    .from("organizations")
    .insert(values)
    .select("id, name, slug")
    .single<{ id: string; name: string; slug: string }>();

  if (orgError || !organization) {
    if (orgError?.code === "23505") {
      throw new Error(
        "The company handle was claimed by another setup. Refresh the company list and choose an available handle if needed.",
      );
    }
    throw new Error(orgError?.message ?? "Could not create company.");
  }
  return organization;
}

async function seedStarterWorkspace(
  input: CompanySetupInput | ExistingUserCompanySetupInput | InvitationCompanySetupInput,
  organizationId: string,
  options: { idempotent?: boolean } = {},
): Promise<void> {
  await seedBusinessHours(organizationId, options.idempotent);
  if (input.copyCatalog) {
    await copyStarterCatalog(
      input.sourceCatalogOrganizationId ?? DEFAULT_ORGANIZATION_ID,
      organizationId,
      options.idempotent,
    );
  }
}

async function seedBusinessHours(
  organizationId: string,
  idempotent = false,
): Promise<void> {
  const service = getServiceSupabase();
  const rows = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    organization_id: organizationId,
    day_of_week: day,
    start_time: "09:00",
    end_time: "17:00",
    enabled: day >= 1 && day <= 5,
  }));
  const { error } = await service.from("business_hours").upsert(
    rows,
    idempotent
      ? { onConflict: "organization_id,day_of_week", ignoreDuplicates: true }
      : undefined,
  );
  if (error) throw new Error(`Could not seed business hours: ${error.message}`);
}

async function copyStarterCatalog(
  fromOrganizationId: string,
  toOrganizationId: string,
  idempotent = false,
): Promise<void> {
  const service = getServiceSupabase();
  const { data, error } = await service
    .from("catalog_items")
    .select("*")
    .eq("organization_id", fromOrganizationId)
    .order("display_order", { ascending: true })
    .returns<CatalogItemRow[]>();
  if (error) throw new Error(`Could not read starter catalog: ${error.message}`);
  if (!data?.length) return;

  const inserts: CatalogItemInsert[] = data.map((item) =>
    compactCatalogInsert({
      organization_id: toOrganizationId,
      kind: item.kind as CatalogItemKind,
      slug: item.slug,
      name: item.name,
      description: item.description,
      duration_minutes: item.duration_minutes,
      price_cents: item.price_cents,
      sqft_pricing_enabled: item.sqft_pricing_enabled,
      included_sqft: item.included_sqft,
      overage_increment_sqft: item.overage_increment_sqft,
      overage_price_cents: item.overage_price_cents,
      taxable: item.taxable,
      active: item.active,
      display_order: item.display_order,
      is_photo: item.is_photo,
      is_video: item.is_video,
      require_has_video: item.require_has_video,
      badge: item.badge,
      highlight: item.highlight,
      ideal_for: item.ideal_for,
    }),
  );
  const catalogMutation = idempotent
    ? service.from("catalog_items").upsert(inserts, {
        onConflict: "organization_id,slug",
        ignoreDuplicates: true,
      })
    : service.from("catalog_items").insert(inserts);
  const { error: insertError } = await catalogMutation;
  if (insertError) {
    throw new Error(`Could not copy starter catalog: ${insertError.message}`);
  }
}

function compactCatalogInsert(row: CatalogItemInsert): CatalogItemInsert {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined),
  ) as CatalogItemInsert;
}

function invitationRecoveryIds(email: string): {
  invitationId: string;
  organizationId: string;
} {
  const normalizedEmail = email.trim().toLowerCase();
  return {
    invitationId: deterministicUuid("company-invitation", normalizedEmail),
    organizationId: deterministicUuid("company-organization", normalizedEmail),
  };
}

function deterministicUuid(namespace: string, value: string): string {
  const hex = createHash("sha256")
    .update(`${namespace}\0${value}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type InvitationAuthRecovery =
  | { status: "found"; userId: string }
  | { status: "absent" }
  | { status: "unresolved" };

async function recoverInvitationAuthUser(
  invitationId: string,
  options: { waitForCommit?: boolean } = {},
): Promise<InvitationAuthRecovery> {
  const service = getServiceSupabase();
  const attempts = options.waitForCommit ? 5 : 1;
  let finalStatus: "absent" | "unresolved" = "unresolved";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const { data, error } = await service.rpc(
        "find_company_invitation_auth_user",
        { p_invitation_id: invitationId },
      );
      if (!error) {
        if (typeof data === "string" && data) {
          return { status: "found", userId: data };
        }
        finalStatus = data === null ? "absent" : "unresolved";
      } else {
        finalStatus = "unresolved";
        console.error(
          "[company-setup.recovery] invitation user lookup failed",
          error.message,
        );
      }
    } catch (error) {
      finalStatus = "unresolved";
      console.error(
        "[company-setup.recovery] invitation user lookup failed",
        error,
      );
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  return { status: finalStatus };
}

async function cleanupFailedCompany(
  organizationId: string | null,
  createdUserId: string | null,
): Promise<string | null> {
  const service = getServiceSupabase();
  const failures: string[] = [];

  async function runStep(
    label: string,
    action: () => PromiseLike<{ error: { message: string } | null }>,
  ): Promise<void> {
    try {
      const result = await action();
      if (result.error) {
        console.error(`[company-setup.cleanup] ${label}`, result.error.message);
        failures.push(label);
      }
    } catch (error) {
      console.error(`[company-setup.cleanup] ${label}`, error);
      failures.push(label);
    }
  }

  if (organizationId) {
    if (createdUserId) {
      await runStep("remove owner membership", () =>
        service
          .from("organization_members")
          .delete()
          .eq("organization_id", organizationId)
          .eq("profile_id", createdUserId),
      );
      await runStep("remove owner profile", () =>
        service
          .from("profiles")
          .delete()
          .eq("organization_id", organizationId)
          .eq("id", createdUserId),
      );
    }
    await runStep("remove copied catalog", () =>
      service
        .from("catalog_items")
        .delete()
        .eq("organization_id", organizationId),
    );
    await runStep("remove business hours", () =>
      service
        .from("business_hours")
        .delete()
        .eq("organization_id", organizationId),
    );
    await runStep("remove organization", () =>
      service.from("organizations").delete().eq("id", organizationId),
    );
  }

  if (createdUserId) {
    await runStep("remove auth user", async () => {
      const result = await service.auth.admin.deleteUser(createdUserId);
      return { error: result.error };
    });
  }

  return failures.length ? failures.join(", ") : null;
}
