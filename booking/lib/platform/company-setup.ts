import "server-only";

import { emailHasAccount } from "@/lib/auth/email-lookup";
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

export interface CompanySetupResult {
  ok: boolean;
  error?: string;
  companyName?: string;
  slug?: string;
  adminEmail?: string;
  bookingPath?: string;
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
    await cleanupFailedCompany(organization.id, createdUserId);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Company setup failed.",
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
    await cleanupFailedCompany(organization.id, null);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Company setup failed.",
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
  input: CompanySetupInput | ExistingUserCompanySetupInput,
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

async function ensureSlugAvailable(slug: string): Promise<string | null> {
  const service = getServiceSupabase();
  const { data: existingOrg, error: slugError } = await service
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle<{ id: string }>();
  if (slugError) return slugError.message;
  if (existingOrg) return "That company handle is already taken.";
  return null;
}

async function createOrganization(
  input: CompanySetupInput | ExistingUserCompanySetupInput,
): Promise<{ id: string; name: string; slug: string }> {
  const service = getServiceSupabase();
  const { data: organization, error: orgError } = await service
    .from("organizations")
    .insert({
      name: input.companyName,
      slug: input.slug,
      primary_color: input.primaryColor,
      accent_color: input.accentColor,
    })
    .select("id, name, slug")
    .single<{ id: string; name: string; slug: string }>();

  if (orgError || !organization) {
    throw new Error(orgError?.message ?? "Could not create company.");
  }
  return organization;
}

async function seedStarterWorkspace(
  input: CompanySetupInput | ExistingUserCompanySetupInput,
  organizationId: string,
): Promise<void> {
  await seedBusinessHours(organizationId);
  if (input.copyCatalog) {
    await copyStarterCatalog(
      input.sourceCatalogOrganizationId ?? DEFAULT_ORGANIZATION_ID,
      organizationId,
    );
  }
}

async function seedBusinessHours(organizationId: string): Promise<void> {
  const service = getServiceSupabase();
  const rows = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    organization_id: organizationId,
    day_of_week: day,
    start_time: "09:00",
    end_time: "17:00",
    enabled: day >= 1 && day <= 5,
  }));
  const { error } = await service.from("business_hours").upsert(rows);
  if (error) throw new Error(`Could not seed business hours: ${error.message}`);
}

async function copyStarterCatalog(
  fromOrganizationId: string,
  toOrganizationId: string,
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
  const { error: insertError } = await service
    .from("catalog_items")
    .insert(inserts);
  if (insertError) {
    throw new Error(`Could not copy starter catalog: ${insertError.message}`);
  }
}

function compactCatalogInsert(row: CatalogItemInsert): CatalogItemInsert {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined),
  ) as CatalogItemInsert;
}

async function cleanupFailedCompany(
  organizationId: string,
  createdUserId: string | null,
): Promise<void> {
  const service = getServiceSupabase();
  if (createdUserId) {
    await service.auth.admin.deleteUser(createdUserId);
  }
  await service
    .from("catalog_items")
    .delete()
    .eq("organization_id", organizationId);
  await service
    .from("business_hours")
    .delete()
    .eq("organization_id", organizationId);
  await service.from("organizations").delete().eq("id", organizationId);
}
