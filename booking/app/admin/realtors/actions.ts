"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { realtorAIMemoryToJson, type RealtorAIMemory } from "@/lib/realtors/memory";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];
type ServiceSupabase = ReturnType<typeof getServiceSupabase>;

interface ProfileMediaRow {
  profile_photo_url: string | null;
  brokerage_logo_url: string | null;
}

const PROFILE_MEDIA_BUCKET = "profile-media";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const ACTIVE_BOOKING_STATUSES = ["requested", "confirmed", "shot", "editing"] as const;

export async function updateRealtorProfile(
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const profileId = cleanText(formData.get("profile_id"));
  if (!profileId) return { ok: false, error: "Missing realtor profile." };

  const websiteUrl = parseOptionalUrl(
    cleanText(formData.get("website_url")),
    "Website URL",
  );
  if (!websiteUrl.ok) return { ok: false, error: websiteUrl.error };

  const instagramUrl = parseOptionalUrl(
    cleanText(formData.get("instagram_url")),
    "Instagram URL",
  );
  if (!instagramUrl.ok) return { ok: false, error: instagramUrl.error };

  const deliveryCcEmails = parseEmailList(
    cleanText(formData.get("delivery_cc_emails")),
  );
  if (!deliveryCcEmails.ok) {
    return { ok: false, error: deliveryCcEmails.error };
  }
  const alternatePhones = parsePhoneList(
    cleanText(formData.get("alternate_phones")),
  );

  const service = getServiceSupabase();
  const { data: currentProfile, error: currentProfileError } = await service
    .from("profiles")
    .select("profile_photo_url, brokerage_logo_url")
    .eq("id", profileId)
    .eq("organization_id", admin.organizationId)
    .eq("role", "realtor")
    .maybeSingle<ProfileMediaRow>();
  if (currentProfileError) {
    return { ok: false, error: currentProfileError.message };
  }
  if (!currentProfile) {
    return { ok: false, error: "Realtor profile was not found." };
  }

  const profilePhoto = await resolveImageField({
    service,
    organizationId: admin.organizationId,
    profileId,
    kind: "headshot",
    fileEntry: formData.get("profile_photo_file"),
    currentUrl: currentProfile.profile_photo_url,
    clear: formData.get("clear_profile_photo") === "on",
  });
  if (!profilePhoto.ok) return { ok: false, error: profilePhoto.error };

  const brokerageLogo = await resolveImageField({
    service,
    organizationId: admin.organizationId,
    profileId,
    kind: "logo",
    fileEntry: formData.get("brokerage_logo_file"),
    currentUrl: currentProfile.brokerage_logo_url,
    clear: formData.get("clear_brokerage_logo") === "on",
  });
  if (!brokerageLogo.ok) return { ok: false, error: brokerageLogo.error };

  const update: ProfileUpdate = {
    full_name: cleanText(formData.get("full_name")) || null,
    phone: cleanText(formData.get("phone")) || null,
    alternate_phones: alternatePhones,
    brokerage: cleanText(formData.get("brokerage")) || null,
    profile_photo_url: profilePhoto.url,
    brokerage_logo_url: brokerageLogo.url,
    website_url: websiteUrl.value,
    instagram_url: instagramUrl.value,
    delivery_cc_emails: deliveryCcEmails.emails,
    internal_notes: cleanText(formData.get("internal_notes")) || null,
    ai_memory: realtorAIMemoryToJson(parseMemoryForm(formData)),
  };

  const { data: updatedProfile, error } = await service
    .from("profiles")
    .update(update)
    .eq("id", profileId)
    .eq("organization_id", admin.organizationId)
    .eq("role", "realtor")
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) return { ok: false, error: error.message };
  if (!updatedProfile) {
    return { ok: false, error: "Realtor profile was not found." };
  }

  revalidatePath("/admin/realtors");
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/today");
  revalidatePath("/portal");
  return { ok: true };
}

export async function archiveRealtorProfile(
  profileId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const cleanProfileId = profileId.trim();
  if (!cleanProfileId) return { ok: false, error: "Missing realtor profile." };

  const service = getServiceSupabase();
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id, email, archived_at")
    .eq("id", cleanProfileId)
    .eq("organization_id", admin.organizationId)
    .eq("role", "realtor")
    .maybeSingle<{ id: string; email: string; archived_at: string | null }>();

  if (profileError) return { ok: false, error: profileError.message };
  if (!profile) return { ok: false, error: "Realtor profile was not found." };
  if (profile.archived_at) return { ok: true };

  const { count, error: bookingError } = await service
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", admin.organizationId)
    .eq("owner_id", cleanProfileId)
    .in("status", [...ACTIVE_BOOKING_STATUSES]);

  if (bookingError) return { ok: false, error: bookingError.message };
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error:
        "This realtor still has active shoots. Finish, deliver, or cancel those bookings before removing the agent.",
    };
  }

  const { data: updated, error } = await service
    .from("profiles")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", cleanProfileId)
    .eq("organization_id", admin.organizationId)
    .eq("role", "realtor")
    .is("archived_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Realtor profile was already removed." };

  revalidatePath("/admin/realtors");
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/calendar");
  revalidatePath("/admin/today");
  return { ok: true };
}

function cleanText(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePhoneList(input: string): string[] {
  if (!input) return [];
  return Array.from(
    new Set(
      input
        .split(/[\n,;]+/)
        .map((phone) => phone.trim())
        .filter(Boolean),
    ),
  ).slice(0, 10);
}

function parseEmailList(
  input: string,
): { ok: true; emails: string[] } | { ok: false; error: string } {
  if (!input) return { ok: true, emails: [] };

  const rawEmails = input
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const invalid = rawEmails.find(
    (email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
  );
  if (invalid) {
    return { ok: false, error: `${invalid} does not look like a valid email.` };
  }

  const emails = Array.from(new Set(rawEmails));
  if (emails.length > 20) {
    return { ok: false, error: "Use 20 delivery CC emails or fewer." };
  }
  return { ok: true, emails };
}

function parseMemoryForm(formData: FormData): RealtorAIMemory {
  return {
    preferredServices: parseList(cleanText(formData.get("memory_preferred_services"))),
    preferredAddOns: parseList(cleanText(formData.get("memory_preferred_addons"))),
    preferredCities: parseList(cleanText(formData.get("memory_preferred_cities"))),
    typicalSquareFootage: parsePositiveInt(
      cleanText(formData.get("memory_typical_sqft")),
    ),
    deliveryPreferences: parseList(
      cleanText(formData.get("memory_delivery_preferences")),
    ),
    communicationStyle:
      cleanText(formData.get("memory_communication_style")) || null,
    accessNotes: parseList(cleanText(formData.get("memory_access_notes"))),
    invoicePreferences:
      cleanText(formData.get("memory_invoice_preferences")) || null,
    avoidReminders: parseList(cleanText(formData.get("memory_avoid_reminders"))),
  };
}

function parseList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\n|;/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

function parsePositiveInt(value: string): number | null {
  if (!value) return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function parseOptionalUrl(
  raw: string,
  label: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (!raw) return { ok: true, value: null };
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, error: `${label} must start with http:// or https://.` };
    }
    return { ok: true, value: url.toString() };
  } catch {
    return { ok: false, error: `${label} is not a valid link.` };
  }
}

async function resolveImageField({
  service,
  organizationId,
  profileId,
  kind,
  fileEntry,
  currentUrl,
  clear,
}: {
  service: ServiceSupabase;
  organizationId: string;
  profileId: string;
  kind: "headshot" | "logo";
  fileEntry: FormDataEntryValue | null;
  currentUrl: string | null;
  clear: boolean;
}): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  if (clear) return { ok: true, url: null };

  const uploaded = await uploadImageIfPresent(
    service,
    organizationId,
    profileId,
    kind,
    fileEntry,
  );
  if (!uploaded.ok) return uploaded;
  if (uploaded.url) return uploaded;

  return { ok: true, url: currentUrl };
}

async function uploadImageIfPresent(
  service: ServiceSupabase,
  organizationId: string,
  profileId: string,
  kind: "headshot" | "logo",
  entry: FormDataEntryValue | null,
): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  if (!(entry instanceof File) || entry.size === 0) {
    return { ok: true, url: null };
  }
  if (entry.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "Images must be 5 MB or smaller." };
  }
  if (!ALLOWED_IMAGE_TYPES.has(entry.type)) {
    return {
      ok: false,
      error: "Use a JPG, PNG, WebP, or GIF image.",
    };
  }

  const extension = extensionFor(entry);
  const bytes = Buffer.from(await entry.arrayBuffer());
  return storeImageBytes(
    service,
    organizationId,
    profileId,
    kind,
    bytes,
    entry.type,
    extension,
  );
}

async function storeImageBytes(
  service: ServiceSupabase,
  organizationId: string,
  profileId: string,
  kind: "headshot" | "logo",
  bytes: Buffer,
  contentType: string,
  extension: string,
): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  const path = `organizations/${organizationId}/realtors/${profileId}/${kind}-${Date.now()}-${randomUUID()}.${extension}`;

  const { error } = await service.storage
    .from(PROFILE_MEDIA_BUCKET)
    .upload(path, bytes, {
      contentType,
      cacheControl: "3600",
      upsert: true,
    });

  if (error) return { ok: false, error: error.message };

  const { data } = service.storage.from(PROFILE_MEDIA_BUCKET).getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}

function extensionFor(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "jpg";
}
