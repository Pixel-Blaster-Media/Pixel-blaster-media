"use server";

import { randomUUID } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
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

export async function updateRealtorProfile(
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

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

  const service = getServiceSupabase();
  const { data: currentProfile, error: currentProfileError } = await service
    .from("profiles")
    .select("profile_photo_url, brokerage_logo_url")
    .eq("id", profileId)
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
    profileId,
    kind: "headshot",
    label: "Profile photo",
    fileEntry: formData.get("profile_photo_file"),
    urlInput: cleanText(formData.get("profile_photo_url")),
    currentUrl: currentProfile.profile_photo_url,
    clear: formData.get("clear_profile_photo") === "on",
  });
  if (!profilePhoto.ok) return { ok: false, error: profilePhoto.error };

  const brokerageLogo = await resolveImageField({
    service,
    profileId,
    kind: "logo",
    label: "Brokerage logo",
    fileEntry: formData.get("brokerage_logo_file"),
    urlInput: cleanText(formData.get("brokerage_logo_url")),
    currentUrl: currentProfile.brokerage_logo_url,
    clear: formData.get("clear_brokerage_logo") === "on",
  });
  if (!brokerageLogo.ok) return { ok: false, error: brokerageLogo.error };

  const update: ProfileUpdate = {
    full_name: cleanText(formData.get("full_name")) || null,
    phone: cleanText(formData.get("phone")) || null,
    brokerage: cleanText(formData.get("brokerage")) || null,
    profile_photo_url: profilePhoto.url,
    brokerage_logo_url: brokerageLogo.url,
    website_url: websiteUrl.value,
    instagram_url: instagramUrl.value,
  };

  const { data: updatedProfile, error } = await service
    .from("profiles")
    .update(update)
    .eq("id", profileId)
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

function cleanText(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
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
  profileId,
  kind,
  label,
  fileEntry,
  urlInput,
  currentUrl,
  clear,
}: {
  service: ServiceSupabase;
  profileId: string;
  kind: "headshot" | "logo";
  label: string;
  fileEntry: FormDataEntryValue | null;
  urlInput: string;
  currentUrl: string | null;
  clear: boolean;
}): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  if (clear) return { ok: true, url: null };

  const uploaded = await uploadImageIfPresent(
    service,
    profileId,
    kind,
    fileEntry,
  );
  if (!uploaded.ok) return uploaded;
  if (uploaded.url) return uploaded;

  if (!urlInput) return { ok: true, url: currentUrl };
  if (urlInput === currentUrl) return { ok: true, url: currentUrl };

  return importImageFromUrl(service, profileId, kind, label, urlInput);
}

async function uploadImageIfPresent(
  service: ServiceSupabase,
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
  return storeImageBytes(service, profileId, kind, bytes, entry.type, extension);
}

async function importImageFromUrl(
  service: ServiceSupabase,
  profileId: string,
  kind: "headshot" | "logo",
  label: string,
  rawUrl: string,
): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  const parsed = await parseImportImageUrl(rawUrl, label);
  if (!parsed.ok) return parsed;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let response: Response;
  try {
    response = await fetch(parsed.url, {
      signal: controller.signal,
      redirect: "error",
      headers: { "User-Agent": "Pixel Blaster Booking/1.0" },
    });
  } catch {
    return { ok: false, error: `${label} URL could not be downloaded.` };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `${label} URL returned ${response.status}. Try uploading the file instead.`,
    };
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_IMAGE_BYTES) {
    return { ok: false, error: `${label} image must be 5 MB or smaller.` };
  }

  const contentType = normalizeContentType(response.headers.get("content-type"));
  if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) {
    return {
      ok: false,
      error: `${label} URL must point directly to a JPG, PNG, WebP, or GIF image.`,
    };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    return { ok: false, error: `${label} URL downloaded an empty file.` };
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, error: `${label} image must be 5 MB or smaller.` };
  }

  return storeImageBytes(
    service,
    profileId,
    kind,
    bytes,
    contentType,
    extensionForContentType(contentType),
  );
}

async function storeImageBytes(
  service: ServiceSupabase,
  profileId: string,
  kind: "headshot" | "logo",
  bytes: Buffer,
  contentType: string,
  extension: string,
): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  const path = `realtors/${profileId}/${kind}-${Date.now()}-${randomUUID()}.${extension}`;

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

async function parseImportImageUrl(
  raw: string,
  label: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: `${label} URL is not a valid link.` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: `${label} URL must start with http:// or https://.` };
  }
  if (await isBlockedHost(url.hostname)) {
    return { ok: false, error: `${label} URL is not a public image link.` };
  }
  return { ok: true, url: url.toString() };
}

async function isBlockedHost(hostname: string): Promise<boolean> {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return true;
  }

  const literalIp = isIP(host);
  if (literalIp && isPrivateIp(host)) return true;

  try {
    const records = await lookup(host, { all: true, verbatim: false });
    return records.some((record) => isPrivateIp(record.address));
  } catch {
    return true;
  }
}

function isPrivateIp(address: string): boolean {
  const normalized = address.toLowerCase();
  if (
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  ) {
    return true;
  }
  const parts = normalized.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function normalizeContentType(raw: string | null): string | null {
  return raw?.split(";")[0]?.trim().toLowerCase() || null;
}

function extensionForContentType(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  return "jpg";
}

function extensionFor(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "jpg";
}
