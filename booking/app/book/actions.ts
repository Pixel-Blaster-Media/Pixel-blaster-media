"use server";

import { redirect } from "next/navigation";

import { emailHasAccount } from "@/lib/auth/email-lookup";
import {
  setSupabaseSessionCookie,
  signInWithPasswordREST,
} from "@/lib/auth/set-session-cookie";
import {
  BUSINESS_TZ,
  isSlotAvailable,
} from "@/lib/booking/availability";
import { getActiveCatalog, getCatalogItemPrice } from "@/lib/booking/catalog";
import { sendEmail } from "@/lib/email/resend";
import { getAdminNotificationEmail } from "@/lib/email/settings";
import { getGoogleCalendarClient } from "@/lib/integrations/google-calendar/client";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";
import { resolvePublicBookingOrganization } from "@/lib/organizations/public-booking";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

interface InsertedRow {
  id: string;
}

export interface BookResult {
  ok: boolean;
  errors?: Record<string, string>;
}

export interface RealtorLookupResult {
  found: boolean;
  email?: string;
  fullName?: string | null;
  phone?: string | null;
  brokerage?: string | null;
}

interface RealtorPhoneMatch {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  alternate_phones: string[] | null;
  brokerage: string | null;
  organization_id: string | null;
}

/**
 * Server action exposed to the client form for email-existence checks.
 * Returns true if an account already exists for this email.
 *
 * "use server" functions are callable from Client Components — we call
 * this on email blur to decide whether to label the password field
 * "Password" (sign in) or "Create a password" (sign up).
 */
export async function checkEmailAction(email: string): Promise<boolean> {
  return emailHasAccount(email);
}

/**
 * Public booking helper: recognize a returning realtor by exact phone number.
 *
 * This intentionally returns only lightweight contact fields, scoped to the
 * requested booking organization, so the form can feel personal without opening
 * a broad profile-search surface.
 */
export async function lookupRealtorByPhoneAction(
  organizationSlug: string | null,
  rawPhone: string,
): Promise<RealtorLookupResult> {
  const phoneDigits = normalizePhone(rawPhone);
  if (phoneDigits.length < 10) return { found: false };

  const organization = await resolvePublicBookingOrganization(
    organizationSlug ?? "",
  );
  if (!organization) return { found: false };

  const match = await findRealtorByPhone(
    getServiceSupabase(),
    organization.id,
    phoneDigits,
  );
  if (!match) return { found: false };

  return {
    found: true,
    email: match.email,
    fullName: match.full_name,
    phone: match.phone,
    brokerage: match.brokerage,
  };
}

/**
 * Instant booking — replaces the old "request booking" flow.
 *
 * Four auth paths, chosen based on session state:
 *
 *   1. Already signed in → use session.user directly.
 *   2. Returning realtor phone match → attach booking to that profile without
 *      forcing portal sign-in.
 *   3. Not signed in, email has an account → sign in with password.
 *   4. Not signed in, email is new → create the auth user (pre-confirmed
 *      via admin API so there's no verification email click-through),
 *      sign them in, move on.
 *
 * Then (in all three paths):
 *   - Re-validate cart slugs against live catalog
 *   - Re-check slot availability (race protection)
 *   - Upsert property, insert booking (status=confirmed)
 *   - Push Google Calendar event (best-effort)
 *   - Send client confirmation + admin notification emails (best-effort)
 *   - Redirect signed-in clients to /portal, or passwordless returning clients
 *     to a public success screen
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

  // -------- Resolve current user: existing session, sign-in, or sign-up --------
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
  const signedInToPortal = authResult.signedInToPortal;

  // -------- Re-validate catalog items --------
  const catalog = await getActiveCatalog({ organizationId });
  const bySlug = new Map<string, (typeof catalog.bundles)[number]>();
  for (const r of catalog.bundles) bySlug.set(r.slug, r);
  for (const r of catalog.aLaCarte) bySlug.set(r.slug, r);
  for (const r of catalog.addons) bySlug.set(r.slug, r);

  const validServices: typeof catalog.bundles = [];
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

  const hasVideo = validServices.some((s) => s.is_video);
  const validAddons: typeof catalog.bundles = [];
  for (const slug of addOnSlugs) {
    const item = bySlug.get(slug);
    if (!item || item.kind !== "addon") continue;
    if (item.require_has_video && !hasVideo) continue;
    validAddons.push(item);
  }

  const duration = Math.max(
    validServices.reduce((n, s) => n + s.duration_minutes, 0) +
      validAddons.reduce((n, a) => n + a.duration_minutes, 0),
    60,
  );

  // -------- Re-check slot availability (defends against races) --------
  const stillFree = await isSlotAvailable(slotStart, duration, {
    organizationId,
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

  const supabase = getServiceSupabase();

  // -------- Upsert property (dedup on owner + address) --------
  const { data: existingProperty } = await supabase
    .from("properties")
    .select("id")
    .eq("owner_id", userId)
    .eq("organization_id", organizationId)
    .eq("street_address", streetAddress)
    .limit(1)
    .maybeSingle<InsertedRow>();

  let propertyId: string | null = existingProperty?.id ?? null;
  if (!propertyId) {
    const { data: created, error: propErr } = await supabase
      .from("properties")
      .insert({
        organization_id: organizationId,
        owner_id: userId,
        street_address: streetAddress,
        city: city || null,
        postal_code: postalCode || null,
      })
      .select("id")
      .single<InsertedRow>();
    if (propErr || !created) {
      console.error("[book] property insert failed", propErr);
      return {
        ok: false,
        errors: { _form: "Could not save property. Try again." },
      };
    }
    propertyId = created.id;
  }

  // -------- Insert booking --------
  const legacyServices = validServices.map((s) => s.slug);
  const legacyAddons = validAddons.map((a) => a.slug);

  const { data: booking, error: bookErr } = await supabase
    .from("bookings")
    .insert({
      organization_id: organizationId,
      property_id: propertyId,
      owner_id: userId,
      status: "confirmed",
      scheduled_at: slotStart.toISOString(),
      scheduled_ends_at: new Date(
        slotStart.getTime() + duration * 60_000,
      ).toISOString(),
      services: legacyServices,
      add_ons: legacyAddons,
      client_notes: combinedNotes || null,
      unit_number: unitNumber || null,
      square_footage: squareFootage,
      is_vacant: isVacant,
      include_basement: includeBasement,
    })
    .select("id")
    .single<InsertedRow>();

  if (bookErr || !booking) {
    console.error("[book] booking insert failed", bookErr);
    if (bookErr?.code === "23P01") {
      return {
        ok: false,
        errors: {
          _form:
            "That slot was just taken. Please pick another — the calendar has been refreshed.",
        },
      };
    }
    return {
      ok: false,
      errors: { _form: "Could not save booking. Try again." },
    };
  }

  const bookingLineItems = [...validServices, ...validAddons].map((item) => ({
    booking_id: booking.id,
    catalog_item_id: item.id,
    quantity: 1,
    unit_price_cents: getCatalogItemPrice(item, squareFootage).totalPriceCents,
    unit_duration_minutes: item.duration_minutes,
  }));
  if (bookingLineItems.length > 0) {
    const { error: lineErr } = await supabase
      .from("booking_line_items")
      .insert(bookingLineItems);
    if (lineErr) {
      console.warn("[book] booking line items insert failed", lineErr);
    }
  }

  // -------- Google Calendar event (best-effort) --------
  try {
    const gcal = await getGoogleCalendarClient({ organizationId });
    if (gcal) {
      const endAt = new Date(slotStart.getTime() + duration * 60_000);
      const serviceLabels = validServices.map((s) => s.name).join(", ");
      const addonLabels = validAddons.map((a) => a.name).join(", ");
      const streetLine = unitNumber
        ? `${streetAddress}, Unit ${unitNumber}`
        : streetAddress;
      const addressLine = [streetLine, city, postalCode]
        .filter(Boolean)
        .join(", ");
      const occupancyLabel =
        isVacant === "vacant"
          ? "Vacant"
          : isVacant === "partial"
            ? "Partially occupied"
            : isVacant === "occupied"
              ? "Occupied"
              : null;
      const event = await gcal.createEvent({
        summary: calendarShootTitle({
          realtor: userDisplayName,
          services: serviceLabels,
          address: streetLine,
        }),
        location: addressLine,
        description:
          `Realtor: ${userDisplayName}\nEmail: ${userEmail}\n` +
          (contactPhone ? `Phone: ${contactPhone}\n` : "") +
          `Services: ${serviceLabels}\n` +
          (addonLabels ? `Add-ons: ${addonLabels}\n` : "") +
          (squareFootage ? `Size: ~${squareFootage} sqft\n` : "") +
          (occupancyLabel ? `Occupancy: ${occupancyLabel}\n` : "") +
          (includeBasement != null
            ? `Basement: ${includeBasement ? "include" : "skip"}\n`
            : "") +
          (combinedNotes ? `\nNotes:\n${combinedNotes}\n` : ""),
        startISO: slotStart.toISOString(),
        endISO: endAt.toISOString(),
        attendeeEmail: userEmail,
        attendeeName: userDisplayName,
      });
      await supabase
        .from("bookings")
        .update({
          google_calendar_event_id: event.id,
          google_calendar_event_url: event.htmlLink,
        })
        .eq("id", booking.id)
        .eq("organization_id", organizationId);
    }
  } catch (err) {
    console.warn("[book] google calendar event create failed", err);
  }

  // -------- Emails (best-effort) --------
  const whenLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    dateStyle: "full",
    timeStyle: "short",
  }).format(slotStart);
  const serviceLabels = validServices.map((s) => s.name).join(", ");
  const addonLabels = validAddons.map((a) => a.name).join(", ");
  const emailAddressLine = unitNumber
    ? `${streetAddress}, Unit ${unitNumber}`
    : streetAddress;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  await Promise.all([
    sendEmail({
      to: userEmail,
      subject: `Booking confirmed — ${emailAddressLine}`,
      organizationId,
      html: `
        <p>Hi ${escapeHtml(userDisplayName)},</p>
        <p>Your shoot is booked and on our calendar.</p>
        <p>
          <strong>Address:</strong> ${escapeHtml(emailAddressLine)}<br>
          <strong>When:</strong> ${escapeHtml(whenLabel)}<br>
          <strong>Services:</strong> ${escapeHtml(serviceLabels)}<br>
          ${addonLabels ? `<strong>Add-ons:</strong> ${escapeHtml(addonLabels)}<br>` : ""}
        </p>
        <p>
          ${
            signedInToPortal
              ? `You can view and manage this booking anytime at
          <a href="${appUrl}/portal">${appUrl || "your client portal"}</a>.
          Sign in with ${escapeHtml(userEmail)} and the password you used when booking.`
              : `We recognized your realtor profile, so you did not need to sign into
          the portal just to book. If you want to view media, invoices, or past
          bookings later, go to
          <a href="${appUrl}/portal">${appUrl || "your client portal"}</a>
          and sign in with ${escapeHtml(userEmail)}.`
          }
        </p>
        <p>— ${escapeHtml(organization.name)}</p>
      `,
    }),
    sendAdminNotification({
      booking: {
        id: booking.id,
        address: emailAddressLine,
        whenLabel,
        serviceLabels,
        addonLabels,
        notes: combinedNotes,
      },
      realtor: {
        email: userEmail,
        name: userDisplayName,
      },
      organizationId,
    }),
  ]);

  if (!signedInToPortal) {
    const params = new URLSearchParams({
      address: emailAddressLine,
      when: whenLabel,
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
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.access_token) {
    const userId = decodeUserId(session.access_token);
    if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, email, full_name, organization_id, archived_at")
        .eq("id", userId)
        .maybeSingle<{
          id: string;
          email: string;
          full_name: string | null;
          organization_id: string | null;
          archived_at: string | null;
        }>();
      if (profile) {
        if (profile.archived_at) {
          return removedRealtorAccount();
        }
        if (profile.organization_id !== params.organizationId) {
          return organizationMismatch(params.organizationName);
        }
        return {
          ok: true,
          userId: profile.id,
          email: profile.email,
          fullName: profile.full_name,
          organizationId: profile.organization_id ?? DEFAULT_ORGANIZATION_ID,
          signedInToPortal: true,
        };
      }
    }
  }

  const service = getServiceSupabase();

  // 2) Returning realtor phone match → allow a fast booking without portal sign-in.
  const returningRealtor = await findRealtorByPhone(
    service,
    params.organizationId,
    params.contactPhone,
  );
  if (returningRealtor) {
    await maybeFillProfile(service, returningRealtor.id, {
      organizationId: params.organizationId,
      full_name: params.contactName,
      phone: params.contactPhone,
      brokerage: params.brokerage,
    });
    return {
      ok: true,
      userId: returningRealtor.id,
      email: returningRealtor.email,
      fullName: returningRealtor.full_name ?? params.contactName,
      organizationId:
        returningRealtor.organization_id ?? DEFAULT_ORGANIZATION_ID,
      signedInToPortal: false,
    };
  }

  // From here on, every anonymous path needs contact + password.
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
              ? "That password doesn't match the account on file. Use the reset link if you forgot it."
              : `Sign in failed: ${signIn.error}`,
          },
        },
      };
    }
    await setSupabaseSessionCookie(signIn.tokens, params.contactEmail);

    const service = getServiceSupabase();
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
      .select("id, email, full_name, organization_id, archived_at")
      .eq("id", userId)
      .maybeSingle<{
        id: string;
        email: string;
        full_name: string | null;
        organization_id: string | null;
        archived_at: string | null;
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
    };
  }

  // 3) New email → create user (pre-confirmed) and sign in.
  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email: params.contactEmail,
    password: params.password,
    email_confirm: true,
    user_metadata: { full_name: params.contactName },
  });
  if (createErr || !created.user) {
    console.error("[book] createUser failed", createErr);
    const msg = (createErr?.message ?? "").toLowerCase();
    if (msg.includes("already") && msg.includes("registered")) {
      return {
        ok: false,
        result: {
          ok: false,
          errors: {
            contact_email:
              "An account already exists for this email. Enter your password (or reset it) to continue.",
          },
        },
      };
    }
    return {
      ok: false,
      result: {
        ok: false,
        errors: {
          _form:
            "Could not create your account: " +
            (createErr?.message ?? "unknown error"),
        },
      },
    };
  }

  const newUserId = created.user.id;
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
    // The user was created but sign-in failed — they can still sign in
    // later via /auth/sign-in, so don't block the booking.
    console.warn("[book] sign-in after create failed", signIn.error);
    return {
      ok: false,
      result: {
        ok: false,
        errors: {
          _form:
            "Your account was created but we couldn't sign you in automatically. Try /auth/sign-in.",
        },
      },
    };
  }
  await setSupabaseSessionCookie(signIn.tokens, params.contactEmail);

  return {
    ok: true,
    userId: newUserId,
    email: params.contactEmail,
    fullName: params.contactName,
    organizationId: params.organizationId,
    signedInToPortal: true,
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

async function findRealtorByPhone(
  supabase: ReturnType<typeof getServiceSupabase>,
  organizationId: string,
  rawPhone: string,
): Promise<RealtorPhoneMatch | null> {
  const phoneDigits = normalizePhone(rawPhone);
  if (phoneDigits.length < 10) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, email, full_name, phone, alternate_phones, brokerage, organization_id",
    )
    .eq("organization_id", organizationId)
    .eq("role", "realtor")
    .is("archived_at", null)
    .limit(500)
    .returns<RealtorPhoneMatch[]>();

  if (error) {
    console.warn("[book] realtor phone lookup failed", error.message);
    return null;
  }

  return (
    (data ?? []).find(
      (profile) =>
        [profile.phone, ...(profile.alternate_phones ?? [])].some(
          (phone) => normalizePhone(phone ?? "") === phoneDigits,
        ),
    ) ?? null
  );
}

function calendarShootTitle(args: {
  realtor: string;
  services: string;
  address: string;
}): string {
  return [args.realtor, args.services, args.address]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" - ");
}

async function sendAdminNotification(args: {
  booking: {
    id: string;
    address: string;
    whenLabel: string;
    serviceLabels: string;
    addonLabels: string;
    notes: string;
  };
  realtor: { email: string; name: string };
  organizationId: string;
}): Promise<void> {
  const adminTo = await getAdminNotificationEmail(args.organizationId);
  if (!adminTo) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  await sendEmail({
    to: adminTo,
    subject: `New booking — ${args.booking.address}`,
    organizationId: args.organizationId,
    html: `
      <p><strong>${escapeHtml(args.realtor.name)}</strong> just booked a shoot.</p>
      <p>
        <strong>Address:</strong> ${escapeHtml(args.booking.address)}<br>
        <strong>When:</strong> ${escapeHtml(args.booking.whenLabel)}<br>
        <strong>Services:</strong> ${escapeHtml(args.booking.serviceLabels)}<br>
        ${args.booking.addonLabels ? `<strong>Add-ons:</strong> ${escapeHtml(args.booking.addonLabels)}<br>` : ""}
        ${args.booking.notes ? `<strong>Notes:</strong> ${escapeHtml(args.booking.notes)}<br>` : ""}
      </p>
      <p>Open in admin: ${appUrl}/admin/bookings/${args.booking.id}</p>
    `,
    replyTo: args.realtor.email,
  });
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

function str(fd: FormData, key: string): string {
  return ((fd.get(key) as string | null) ?? "").trim();
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
