"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Database, CatalogItemKind } from "@/lib/supabase/database.types";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

type CatalogItemInsert =
  Database["public"]["Tables"]["catalog_items"]["Insert"];
type CatalogItemUpdate =
  Database["public"]["Tables"]["catalog_items"]["Update"];

const VALID_KINDS: readonly CatalogItemKind[] = [
  "bundle",
  "a_la_carte",
  "addon",
] as const;

function parseDollarsToCents(raw: string): number | null {
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function parseIntSafe(raw: string, min = 0): number | null {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < min) return null;
  return n;
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/**
 * Create a new catalog item. `kind` is a hidden input on the form so each
 * section submits into the right bucket.
 */
export async function createCatalogItem(
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const kindRaw = ((formData.get("kind") as string | null) ?? "").trim();
  if (!VALID_KINDS.includes(kindRaw as CatalogItemKind)) {
    return { ok: false, error: "Invalid kind." };
  }
  const kind = kindRaw as CatalogItemKind;

  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) return { ok: false, error: "Name is required." };

  // Slug can be supplied explicitly, otherwise we derive from the name. If
  // derivation collides we surface the DB unique-violation message as-is.
  const slugRaw = ((formData.get("slug") as string | null) ?? "").trim();
  const slug = slugRaw ? slugify(slugRaw) : slugify(name);
  if (!slug) return { ok: false, error: "Slug could not be derived." };

  const priceCents = parseDollarsToCents(
    (formData.get("price_dollars") as string | null) ?? "0",
  );
  if (priceCents === null) return { ok: false, error: "Invalid price." };

  const duration = parseIntSafe(
    (formData.get("duration_minutes") as string | null) ?? "0",
  );
  if (duration === null) return { ok: false, error: "Invalid duration." };

  const displayOrder = parseIntSafe(
    (formData.get("display_order") as string | null) ?? "0",
  );
  if (displayOrder === null)
    return { ok: false, error: "Invalid display order." };

  const description =
    ((formData.get("description") as string | null) ?? "").trim();
  const badge = ((formData.get("badge") as string | null) ?? "").trim();
  const idealFor = ((formData.get("ideal_for") as string | null) ?? "").trim();

  const insert: CatalogItemInsert = {
    kind,
    slug,
    name,
    description,
    badge: badge || null,
    highlight: formData.get("highlight") === "on",
    ideal_for: idealFor || null,
    price_cents: priceCents,
    duration_minutes: duration,
    display_order: displayOrder,
    taxable: formData.get("taxable") === "on",
    active: formData.get("active") !== null ? formData.get("active") === "on" : true,
    is_video: kind !== "addon" && formData.get("is_video") === "on",
    require_has_video:
      kind === "addon" && formData.get("require_has_video") === "on",
  };

  const supabase = getServiceSupabase();
  const { error } = await supabase.from("catalog_items").insert(insert);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/settings/pricing");
  return { ok: true };
}

export async function updateCatalogItem(
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const id = ((formData.get("id") as string | null) ?? "").trim();
  if (!id) return { ok: false, error: "Missing id." };

  const kindRaw = ((formData.get("kind") as string | null) ?? "").trim();
  if (!VALID_KINDS.includes(kindRaw as CatalogItemKind)) {
    return { ok: false, error: "Invalid kind." };
  }
  const kind = kindRaw as CatalogItemKind;

  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) return { ok: false, error: "Name is required." };

  const priceCents = parseDollarsToCents(
    (formData.get("price_dollars") as string | null) ?? "0",
  );
  if (priceCents === null) return { ok: false, error: "Invalid price." };

  const duration = parseIntSafe(
    (formData.get("duration_minutes") as string | null) ?? "0",
  );
  if (duration === null) return { ok: false, error: "Invalid duration." };

  const displayOrder = parseIntSafe(
    (formData.get("display_order") as string | null) ?? "0",
  );
  if (displayOrder === null)
    return { ok: false, error: "Invalid display order." };

  const badge = ((formData.get("badge") as string | null) ?? "").trim();
  const idealFor = ((formData.get("ideal_for") as string | null) ?? "").trim();

  const update: CatalogItemUpdate = {
    name,
    description: ((formData.get("description") as string | null) ?? "").trim(),
    badge: badge || null,
    highlight: formData.get("highlight") === "on",
    ideal_for: idealFor || null,
    price_cents: priceCents,
    duration_minutes: duration,
    display_order: displayOrder,
    taxable: formData.get("taxable") === "on",
    active: formData.get("active") === "on",
    is_video: kind !== "addon" && formData.get("is_video") === "on",
    require_has_video:
      kind === "addon" && formData.get("require_has_video") === "on",
  };

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("catalog_items")
    .update(update)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/settings/pricing");
  return { ok: true };
}

export async function deleteCatalogItem(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!id) return { ok: false, error: "Missing id." };

  const supabase = getServiceSupabase();
  const { error } = await supabase.from("catalog_items").delete().eq("id", id);
  // Foreign key from booking_line_items has `on delete restrict` so this will
  // fail if the item is referenced by a booking — surface the DB message.
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/settings/pricing");
  return { ok: true };
}
