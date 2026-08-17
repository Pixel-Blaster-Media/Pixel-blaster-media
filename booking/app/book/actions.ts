"use server";

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { emailHasAccount } from "@/lib/auth/email-lookup";
import { provisionRealtorAuthUser } from "@/lib/auth/provision-realtor";
import { rollbackProvisionedRealtor } from "@/lib/auth/rollback-provisioned-realtor";
import {
  setSupabaseSessionCookie,
  signInWithPasswordREST,
} from "@/lib/auth/set-session-cookie";
import type { SessionTokens } from "@/lib/auth/set-session-cookie";
import {
  BUSINESS_TZ,
  isSlotAvailable,
} from "@/lib/booking/availability";
import { getActiveCatalog } from "@/lib/booking/catalog";
import { isAddonEligible } from "@/lib/booking/catalog-rules";
import { createManageToken } from "@/lib/booking/manage-token";

const isCatalogAddonEligible = isAddonEligible;
import { getAdminNotificationEmail } from "@/lib/email/settings";
import { dispatchBookingIntegrationJobs } from "@/lib/integrations/dispatcher";
import { buildIntegrationWorkerId } from "@/lib/integrations/dispatcher-core";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";
import { resolvePublicBookingOrganization } from "@/lib/organizations/public-booking";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];
type BookingCatalogItem = Pick<
  Database["public"]["Tables"]["catalog_items"]["Row"],
  | "id"
  | "slug"
  | "name"
  | "kind"
  | "duration_minutes"
  | "is_photo"
  | "is_video"
  | "is_iguide"
  | "is_aerial"
  | "require_has_video"
  | "require_has_media"
  | "require_has_iguide"
  | "exclude_has_aerial"
>;

interface ExistingRequestRow {
  id: string;
}

interface BookingLineSnapshot {
  catalog_item_id: string;
  item_name: string;
  item_slug: string;
  item_kind: "bundle" | "a_la_carte" | "addon";
  unit_duration_minutes: number;
}

interface AtomicBookingResult {
  booking_id: string;
  property_id: string;
  scheduled_ends_at: string;
  replayed: boolean;
}

export interface BookResult {
  ok: boolean;
  errors?: Record<string, string>;
}

/**
 * Instant booking — replaces the old "request booking" flow.
 *
 * Three auth paths, chosen based on session state:
 *
 *   1. Already signed in → use session.user directly.
 *   2. Not signed in, email has an account → sign in with password.
 *   3. Not signed in, email is new → create the auth user (pre-confirmed
 *      via admin API so there's no verification email click-through),
 *      sign them in, move on.
 *
 * Then (in all three paths):
 *   - Re-validate cart slugs against live catalog
 *   - Re-check slot availability (race protection)
 *   - Commit property, confirmed booking, price snapshots, and durable jobs atomically
 *   - Lease and attempt Calendar, invoice, email, and push jobs after commit
 *   - Preserve failed/skipped provider outcomes for safe reconciliation
 *   - Redirect the signed-in client to /portal
 */
export async function createPublicBooking(
  _prev: BookResult | null,
  formData: FormData,
): Promise<BookResult> {
  // -------- Parse inputs --------
  const serviceSlugs = ((formData.getAll("services") as string[]) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const addOnSlugs = ((formData.getAll("add_ons") as string[]) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const organizationSlug = str(formData, "org");
  const publicRequestId = str(formData, "public_request_id");
  const slotStartRaw = str(formData, "slot");
  const streetAddress = str(formData, "street_address");
  const unitNumber = str(formData, "unit_number");
  const city = str(formData, "city");
  const postalCode = str(formData, "postal_code");
  const squareFootageRaw = str(formData, "square_footage");
  const isVacantRaw = str(formData, "is_vacant");
  const includeBasementRaw = str(formData, "include_basement");
  const mustHaveShots = ((formData.getAll("must_have_shots") as string[]) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const shootNotes = str(formData, "shoot_notes");
  const notes = str(formData, "notes");

  const contactName = str(formData, "contact_name");
  const contactEmail = str(formData, "contact_email").toLowerCase();
  const contactPhone = str(formData, "contact_phone");
  const brokerage = str(formData, "brokerage");
  const password = (formData.get("password") as string | null) ?? "";

  const squareFootage = squareFootageRaw
    ? Math.max(0, Math.trunc(Number(squareFootageRaw)))
    : null;
  const isVacant: "vacant" | "occupied" | "partial" | null =
    isVacantRaw === "vacant" ||
    isVacantRaw === "occupied" ||
    isVacantRaw === "partial"
      ? isVacantRaw
      : null;
  const includeBasement: boolean | null =
    includeBasementRaw === "1"
      ? true
      : includeBasementRaw === "0"
        ? false
        : null;
  const combinedNotes = buildBookingNotes({ mustHaveShots, shootNotes, notes });

  if (serviceSlugs.length === 0) {
    return { ok: false, errors: { _form: "Pick at least one service." } };
  }
  if (!isUuid(publicRequestId)) {
    return {
      ok: false,
      errors: { _form: "This confirmation page expired. Refresh and try again." },
    };
  }

  const organization = await resolvePublicBookingOrganization(organizationSlug);
  if (!organization) {
    return {
      ok: false,
      errors: { _form: "That booking company was not found. Check the link." },
    };
  }

  if (!streetAddress) {
    return {
      ok: false,
      errors: { street_address: "Property address is required." },
    };
  }
  if (!slotStartRaw) {
    return { ok: false, errors: { _form: "Pick a time slot first." } };
  }

  const slotStart = new Date(slotStartRaw);
  if (Number.isNaN(slotStart.getTime())) {
    return {
      ok: false,
      errors: { _form: "That time doesn't look valid — pick again." },
    };
  }

  // Resolve a committed request before mutable catalog and availability checks.
  // Its immutable line snapshots let a lost-response replay survive later catalog
  // deactivation while still rejecting changed service/add-on selections.
  const supabase = getServiceSupabase();
  const { data: existingRequest, error: replayLookupError } = await supabase
    .from("bookings")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("public_request_id", publicRequestId)
    .limit(1)
    .maybeSingle<ExistingRequestRow>();
  if (replayLookupError) {
    console.error("[book] request replay lookup failed", {
      code: replayLookupError.code,
    });
    return {
      ok: false,
      errors: { _form: "Could not verify this booking request. Try again." },
    };
  }

  let validServices: BookingCatalogItem[] = [];
  let validAddons: BookingCatalogItem[] = [];

  if (existingRequest) {
    const { data: snapshotData, error: snapshotError } = await supabase
      .from("booking_line_items")
      .select(
        "catalog_item_id,item_name,item_slug,item_kind,unit_duration_minutes",
      )
      .eq("booking_id", existingRequest.id);
    const snapshots = (snapshotData ?? []) as BookingLineSnapshot[];
    if (snapshotError || snapshots.length === 0) {
      console.error("[book] replay snapshot lookup failed", {
        code: snapshotError?.code ?? "missing_snapshots",
      });
      return committedBookingNeedsSupport(publicRequestId);
    }

    const postedSlugs = [...serviceSlugs, ...addOnSlugs].sort();
    const snapshotSlugs = snapshots.map((item) => item.item_slug).sort();
    if (
      postedSlugs.length !== snapshotSlugs.length ||
      postedSlugs.some((slug, index) => slug !== snapshotSlugs[index])
    ) {
      return {
        ok: false,
        errors: {
          _form:
            "This confirmation was already used with different details. Refresh and try again.",
        },
      };
    }

    const bySnapshotSlug = new Map(
      snapshots.map((item) => [item.item_slug, item] as const),
    );
    const toCatalogItem = (slug: string): BookingCatalogItem => {
      const item = bySnapshotSlug.get(slug)!;
      return {
        id: item.catalog_item_id,
        slug: item.item_slug,
        name: item.item_name,
        kind: item.item_kind,
        duration_minutes: item.unit_duration_minutes,
        is_photo: false,
        is_video: false,
        is_iguide: false,
        is_aerial: false,
        require_has_video: false,
        require_has_media: false,
        require_has_iguide: false,
        exclude_has_aerial: false,
      };
    };
    validServices = serviceSlugs.map(toCatalogItem);
    validAddons = addOnSlugs.map(toCatalogItem);
  } else {
    // -------- Re-validate active catalog items for a new request --------
    const catalog = await getActiveCatalog({ organizationId: organization.id });
    const bySlug = new Map<string, BookingCatalogItem>();
    for (const item of catalog.bundles) bySlug.set(item.slug, item);
    for (const item of catalog.aLaCarte) bySlug.set(item.slug, item);
    for (const item of catalog.addons) bySlug.set(item.slug, item);

    for (const slug of serviceSlugs) {
      const item = bySlug.get(slug);
      if (!item || item.kind === "addon") {
        return {
          ok: false,
          errors: {
            _form: `Unknown service "${slug}". Refresh and try again.`,
          },
        };
      }
      validServices.push(item);
    }

    for (const slug of addOnSlugs) {
      const item = bySlug.get(slug);
      if (!item || item.kind !== "addon") continue;
      if (!isCatalogAddonEligible(item, validServices)) continue;
      validAddons.push(item);
    }
  }

  const duration = Math.max(
    validServices.reduce((total, item) => total + item.duration_minutes, 0) +
      validAddons.reduce((total, item) => total + item.duration_minutes, 0),
    60,
  );

  if (!existingRequest) {
    const stillFree = await isSlotAvailable(slotStart, duration, {
      organizationId: organization.id,
    });
    if (!stillFree) {
      return {
        ok: false,
        errors: {
          _form:
            "That slot was just taken. Please pick another — the calendar has been refreshed.",
        },
      };
    }
  }

  // Provision only after every non-transactional validation has passed. A user
  // created below is rolled back if the property or booking cannot be committed.
  const authResult = await resolveUser({
    organizationId: organization.id,
    organizationName: organization.name,
    contactEmail,
    contactName,
    contactPhone,
    brokerage,
    password,
  });
  if (!authResult.ok) return authResult.result;
  const userId = authResult.userId;
  const userEmail = authResult.email;
  const userDisplayName = authResult.fullName ?? authResult.email;
  const organizationId = authResult.organizationId;
  let signedInToPortal = authResult.signedInToPortal;

  // -------- Commit property + booking + derived price snapshots + outbox atomically --------
  const adminNotificationEmail = await getAdminNotificationEmail(organizationId);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const { data: atomicData, error: bookErr } = await supabase.rpc(
    "create_public_booking_with_jobs",
    {
      p_request_id: publicRequestId,
      p_organization_id: organizationId,
      p_owner_id: userId,
      p_street_address: streetAddress,
      p_city: city,
      p_postal_code: postalCode,
      p_unit_number: unitNumber,
      p_scheduled_at: slotStart.toISOString(),
      p_square_footage: squareFootage,
      p_is_vacant: isVacant,
      p_include_basement: includeBasement,
      p_client_notes: combinedNotes,
      p_service_item_ids: validServices.map((item) => item.id),
      p_add_on_item_ids: validAddons.map((item) => item.id),
      p_admin_notification_email: adminNotificationEmail,
      p_app_url: appUrl,
    },
  );
  const atomic = atomicData as AtomicBookingResult | null;

  if (bookErr || !atomic?.booking_id || !atomic.property_id) {
    console.error("[book] atomic booking commit failed", bookErr);
    if (authResult.newlyCreated) {
      const rollback = await rollbackProvisionedRealtor({
        userId,
        provisioningId: authResult.provisioningId!,
        context: "public-booking-atomic",
      });
      if (rollback.status !== "deleted") {
        return cleanupNeedsSupport(rollback.reference);
      }
    }
    if (bookErr?.code === "23P01") {
      return {
        ok: false,
        errors: {
          _form:
            "That slot was just taken. Please pick another — the calendar has been refreshed.",
        },
      };
    }
    if (bookErr?.code === "PB002") {
      return {
        ok: false,
        errors: {
          _form:
            "Packages changed while you were booking. Refresh and select them again.",
        },
      };
    }
    if (bookErr?.code === "PB004") {
      return {
        ok: false,
        errors: {
          _form:
            "This confirmation was already used with different details. Refresh and try again.",
        },
      };
    }
    return {
      ok: false,
      errors: { _form: "Could not save booking. Try again." },
    };
  }

  const booking = { id: atomic.booking_id };
  const propertyId = atomic.property_id;
  const scheduledEndAt = new Date(atomic.scheduled_ends_at);
  if (Number.isNaN(scheduledEndAt.getTime())) {
    console.error("[book] atomic booking returned an invalid schedule", booking.id);
    return committedBookingNeedsSupport(booking.id);
  }

  if (authResult.sessionTokens) {
    try {
      await setSupabaseSessionCookie(authResult.sessionTokens, authResult.email);
    } catch (error) {
      console.error("[book] post-commit session installation failed", error);
      signedInToPortal = false;
    }
  }

  const dispatchWorkerId = buildIntegrationWorkerId(
    "inline-public-booking",
    randomUUID(),
  );
  await dispatchBookingIntegrationJobs({
    organizationId,
    bookingId: booking.id,
    workerId: dispatchWorkerId,
  });

  // Success-page values are request-local display data only. Every provider
  // mutation above ran from the claimed immutable payload.
  const whenLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    dateStyle: "full",
    timeStyle: "short",
  }).format(slotStart);
  const serviceLabels = validServices.map((service) => service.name).join(", ");
  const emailAddressLine = unitNumber
    ? `${streetAddress}, Unit ${unitNumber}`
    : streetAddress;
  let manageToken: string | null = null;
  try {
    manageToken = createManageToken(booking.id);
  } catch (error) {
    console.warn("[book] manage token creation failed", error);
  }

  if (!signedInToPortal) {
    const params = new URLSearchParams({
      address: emailAddressLine,
      when: whenLabel,
      start: slotStart.toISOString(),
      end: scheduledEndAt.toISOString(),
      services: serviceLabels,
      org: organization.name,
      ...(manageToken ? { manage: manageToken } : {}),
    });
    redirect(`/book/success?${params.toString()}`);
  }

  redirect(`/portal/${propertyId}?booked=1`);
}

// -------- Helpers --------
interface ResolveUserOk {
  ok: true;
  userId: string;
  email: string;
  fullName: string | null;
  organizationId: string;
  signedInToPortal: boolean;
  newlyCreated: boolean;
  provisioningId: string | null;
  sessionTokens: SessionTokens | null;
}
interface ResolveUserErr {
  ok: false;
  result: BookResult;
}

async function resolveUser(params: {
  contactEmail: string;
  contactName: string;
  contactPhone: string;
  brokerage: string;
  password: string;
  organizationId: string;
  organizationName: string;
}): Promise<ResolveUserOk | ResolveUserErr> {
  // 1) Already signed in? Use the existing session.
  const supabase = await getServerSupabase();
  const service = getServiceSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.access_token) {
    const userId = decodeUserId(session.access_token);
    if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, email, full_name, organization_id, archived_at, role")
        .eq("id", userId)
        .maybeSingle<{
          id: string;
          email: string;
          full_name: string | null;
          organization_id: string | null;
          archived_at: string | null;
          role: "admin" | "realtor";
        }>();
      if (profile) {
        if (profile.archived_at) {
          return removedRealtorAccount();
        }
        if (profile.organization_id !== params.organizationId) {
          return organizationMismatch(params.organizationName);
        }
        if (
          profile.role !== "realtor" ||
          (await hasPrivilegedCompanyMembership(
            service,
            profile.id,
            params.organizationId,
          ))
        ) {
          return companyAccountCannotBook();
        }
        return {
          ok: true,
          userId: profile.id,
          email: profile.email,
          fullName: profile.full_name,
          organizationId: profile.organization_id ?? DEFAULT_ORGANIZATION_ID,
          signedInToPortal: true,
          newlyCreated: false,
          provisioningId: null,
          sessionTokens: null,
        };
      }
    }
  }

  // Every anonymous path needs contact details and a password. Public phone
  // matching and email-existence checks exposed client information and could
  // attach a booking to a profile without proving account ownership.
  const errors: Record<string, string> = {};
  if (!params.contactName) errors.contact_name = "Required.";
  if (!params.contactPhone) errors.contact_phone = "Required.";
  if (!params.contactEmail) errors.contact_email = "Required.";
  else if (!params.contactEmail.includes("@")) {
    errors.contact_email = "Looks like that's not a valid email.";
  }
  if (!params.password || params.password.length < 8) {
    errors.password = "At least 8 characters.";
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, result: { ok: false, errors } };
  }

  const exists = await emailHasAccount(params.contactEmail);

  if (exists) {
    // 2) Existing account → sign in.
    const signIn = await signInWithPasswordREST(
      params.contactEmail,
      params.password,
    );
    if (!signIn.ok) {
      const detail = signIn.error.toLowerCase();
      const isBadCreds =
        signIn.status === 400 || detail.includes("invalid");
      return {
        ok: false,
        result: {
          ok: false,
          errors: {
            password: isBadCreds
              ? "We couldn't confirm those account details. Check the email and password, or use the reset link."
              : "We couldn't sign you in right now. Please try again.",
          },
        },
      };
    }
    const userId = decodeUserId(signIn.tokens.access_token);
    if (!userId) {
      return {
        ok: false,
        result: {
          ok: false,
          errors: { _form: "Could not decode the sign-in token. Try again." },
        },
      };
    }
    const { data: profile } = await service
      .from("profiles")
      .select("id, email, full_name, organization_id, archived_at, role")
      .eq("id", userId)
      .maybeSingle<{
        id: string;
        email: string;
        full_name: string | null;
        organization_id: string | null;
        archived_at: string | null;
        role: "admin" | "realtor";
      }>();
    if (!profile) {
      return {
        ok: false,
        result: {
          ok: false,
          errors: { _form: "Account loaded but profile missing — contact support." },
        },
      };
    }
    if (profile.organization_id !== params.organizationId) {
      return organizationMismatch(params.organizationName);
    }
    if (profile.archived_at) {
      return removedRealtorAccount();
    }
    if (
      profile.role !== "realtor" ||
      (await hasPrivilegedCompanyMembership(
        service,
        profile.id,
        params.organizationId,
      ))
    ) {
      return companyAccountCannotBook();
    }
    // Top up phone/brokerage if the user left them empty before, but only
    // after confirming this account belongs to the requested company.
    await maybeFillProfile(service, userId, {
      organizationId: params.organizationId,
      full_name: params.contactName,
      phone: params.contactPhone,
      brokerage: params.brokerage,
    });
    return {
      ok: true,
      userId: profile.id,
      email: profile.email,
      fullName: profile.full_name ?? params.contactName,
      organizationId: profile.organization_id ?? DEFAULT_ORGANIZATION_ID,
      signedInToPortal: true,
      newlyCreated: false,
      provisioningId: null,
      sessionTokens: signIn.tokens,
    };
  }

  // 3) New email → create user (pre-confirmed) and sign in.
  const provisioned = await provisionRealtorAuthUser({
    service,
    email: params.contactEmail,
    password: params.password,
    fullName: params.contactName,
    organizationId: params.organizationId,
    context: "public-booking-create",
  });
  if (!provisioned.ok) {
    return {
      ok: false,
      result: {
        ok: false,
        errors: {
          _form: `${provisioned.message} Reference: ${provisioned.reference}`,
        },
      },
    };
  }

  const newUserId = provisioned.userId;
  const provisioningId = provisioned.provisioningId;
  await maybeFillProfile(service, newUserId, {
    organizationId: params.organizationId,
    setOrganization: true,
    full_name: params.contactName,
    phone: params.contactPhone,
    brokerage: params.brokerage,
  });

  const signIn = await signInWithPasswordREST(
    params.contactEmail,
    params.password,
  );
  if (!signIn.ok) {
    console.warn("[book] sign-in after create failed", signIn.error);
    const rollback = await rollbackProvisionedRealtor({
      userId: newUserId,
      provisioningId,
      context: "public-booking-sign-in",
    });
    if (rollback.status !== "deleted") {
      return { ok: false, result: cleanupNeedsSupport(rollback.reference) };
    }
    return {
      ok: false,
      result: {
        ok: false,
        errors: {
          _form:
            "We couldn't create and verify the account. Please try again.",
        },
      },
    };
  }
  return {
    ok: true,
    userId: newUserId,
    email: params.contactEmail,
    fullName: params.contactName,
    organizationId: params.organizationId,
    signedInToPortal: true,
    newlyCreated: true,
    provisioningId,
    sessionTokens: signIn.tokens,
  };
}

function organizationMismatch(organizationName: string): ResolveUserErr {
  return {
    ok: false,
    result: {
      ok: false,
      errors: {
        _form:
          `You're signed into an account for another booking company. ` +
          `Sign out first, then book with ${organizationName}.`,
      },
    },
  };
}

function cleanupNeedsSupport(reference: string | null): BookResult {
  return {
    ok: false,
    errors: {
      _form:
        "The booking was not completed. Do not retry; email info@pixelblastermedia.com and include this reference." +
        (reference ? ` Reference: ${reference}` : ""),
    },
  };
}

function committedBookingNeedsSupport(reference: string): BookResult {
  return {
    ok: false,
    errors: {
      _form:
        "Your booking was saved, but confirmation could not finish. Do not submit a new booking; email info@pixelblastermedia.com and include this reference." +
        ` Reference: ${reference}`,
    },
  };
}

function companyAccountCannotBook(): ResolveUserErr {
  return {
    ok: false,
    result: {
      ok: false,
      errors: {
        _form:
          "This is a company workspace account, not a realtor portal account. Sign out and use the realtor account that should own the booking.",
      },
    },
  };
}

async function hasPrivilegedCompanyMembership(
  supabase: ReturnType<typeof getServiceSupabase>,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("organization_members")
    .select("profile_id")
    .eq("profile_id", userId)
    .eq("organization_id", organizationId)
    .in("role", ["owner", "admin"])
    .maybeSingle<{ profile_id: string }>();
  if (error) {
    console.error("[book] privileged membership verification failed", error.code);
    return true;
  }
  return Boolean(data);
}

function removedRealtorAccount(): ResolveUserErr {
  return {
    ok: false,
    result: {
      ok: false,
      errors: {
        _form:
          "This realtor account has been removed from the active client list. Contact the photographer to book again.",
      },
    },
  };
}

async function maybeFillProfile(
  supabase: ReturnType<typeof getServiceSupabase>,
  userId: string,
  fields: {
    organizationId: string;
    setOrganization?: boolean;
    full_name?: string;
    phone?: string;
    brokerage?: string;
  },
): Promise<void> {
  // Only write fields that are currently empty — don't clobber anything
  // the admin set manually.
  const { data: current } = await supabase
    .from("profiles")
    .select("organization_id, full_name, phone, brokerage")
    .eq("id", userId)
    .maybeSingle<{
      organization_id: string | null;
      full_name: string | null;
      phone: string | null;
      brokerage: string | null;
    }>();

  const updates: ProfileUpdate = {};
  if (fields.setOrganization || !current?.organization_id) {
    updates.organization_id = fields.organizationId;
  }
  if (!current?.full_name && fields.full_name) {
    updates.full_name = fields.full_name;
  }
  if (!current?.phone && fields.phone) {
    updates.phone = fields.phone;
  }
  if (!current?.brokerage && fields.brokerage) {
    updates.brokerage = fields.brokerage;
  }
  if (Object.keys(updates).length === 0) return;
  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId);
  if (error) console.warn("[book] profile top-up failed", error);
}
function decodeUserId(token: string): string | null {
  try {
    const parts = token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { sub?: string; exp?: number };
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function str(fd: FormData, key: string): string {
  return ((fd.get(key) as string | null) ?? "").trim();
}

function buildBookingNotes({
  mustHaveShots,
  shootNotes,
  notes,
}: {
  mustHaveShots: string[];
  shootNotes: string;
  notes: string;
}): string {
  const parts: string[] = [];
  if (mustHaveShots.length) {
    parts.push(
      `Must-have shots: ${mustHaveShots.map(formatShotRequest).join(", ")}`,
    );
  }
  if (shootNotes) parts.push(`Specific shot notes: ${shootNotes}`);
  if (notes) parts.push(`Booking notes: ${notes}`);
  return parts.join("\n\n");
}

function formatShotRequest(slug: string): string {
  return (
    {
      pool: "Pool / backyard",
      view: "View / exterior",
      upgrades: "Upgrades / details",
      basement: "Basement",
      mechanicals: "Mechanicals",
      neighbourhood: "Neighbourhood",
    } satisfies Record<string, string>
  )[slug] ?? slug;
}
