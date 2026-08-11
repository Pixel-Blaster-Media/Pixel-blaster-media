"use server";

import { getActiveCatalog, type CatalogItemRow } from "@/lib/booking/catalog";
import {
  getSelectedServiceCapabilities,
  isCatalogAddonEligible,
} from "@/lib/booking/catalog-eligibility";
import { getCredential } from "@/lib/integrations/credentials";
import { resolvePublicBookingOrganization } from "@/lib/organizations/public-booking";
import {
  parseRealtorAIMemory,
  summarizeRealtorAIMemory,
  type RealtorAIMemory,
} from "@/lib/realtors/memory";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

const DEFAULT_MODEL =
  process.env.OPENAI_ASSISTANT_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.4-mini";

export interface BookingRecommendation {
  services: string[];
  addOns: string[];
  title: string;
  confidence: "strong" | "good" | "light";
  reasoning: string;
  notes: string[];
  missingInfo: string[];
  property: {
    streetAddress: string | null;
    city: string | null;
    postalCode: string | null;
    squareFootage: number | null;
    isVacant: "vacant" | "occupied" | "partial" | null;
    includeBasement: boolean | null;
    shootNotes: string | null;
    shotRequests: string[];
  };
  memoryUsed: string[];
}

export interface BookingRecommendationContext {
  selectedServices: string[];
  selectedAddOns: string[];
  streetAddress: string | null;
  city: string | null;
  postalCode: string | null;
  squareFootage: number | null;
  isVacant: "vacant" | "occupied" | "partial" | null;
  includeBasement: boolean | null;
  shootNotes: string | null;
  shotRequests: string[];
}

interface ModelRecommendation {
  services: string[];
  addOns: string[];
  title: string;
  confidence: "strong" | "good" | "light";
  reasoning: string;
  notes: string[];
  missingInfo: string[];
  property: {
    streetAddress: string | null;
    city: string | null;
    postalCode: string | null;
    squareFootage: number | null;
    isVacant: "vacant" | "occupied" | "partial" | null;
    includeBasement: boolean | null;
    shootNotes: string | null;
    shotRequests: string[];
  };
  memoryUsed: string[];
}

interface MemoryBookingRow {
  id: string;
  scheduled_at: string | null;
  services: string[];
  add_ons: string[];
  square_footage: number | null;
  client_notes: string | null;
  properties: {
    street_address: string;
    city: string | null;
    postal_code: string | null;
  } | null;
}

interface MemoryProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  internal_notes: string | null;
  delivery_cc_emails: string[] | null;
  ai_memory: Json;
}

interface RealtorMemory {
  profileName: string;
  email: string;
  internalNotes: string[];
  deliveryCcCount: number;
  commonServices: string[];
  commonAddOns: string[];
  commonCities: string[];
  typicalSquareFootage: number | null;
  lastBooking: string | null;
  structuredMemory: string[];
}

export async function recommendBookingPackage(input: {
  description: string;
  organizationSlug?: string | null;
  context?: Partial<BookingRecommendationContext> | null;
}): Promise<{ ok: true; recommendation: BookingRecommendation } | { ok: false; error: string }> {
  const description = input.description.trim().slice(0, 1600);
  if (description.length < 8) {
    return { ok: false, error: "Add a little more detail first." };
  }
  const context = sanitizeRecommendationContext(input.context);

  const organization = await resolvePublicBookingOrganization(input.organizationSlug);
  if (!organization) return { ok: false, error: "Could not find that booking company." };

  const [apiKey, model, catalog, currentProfileId] = await Promise.all([
    getCredential("openai", "api_key", "OPENAI_API_KEY", organization.id),
    getCredential("openai", "model", "OPENAI_ASSISTANT_MODEL", organization.id),
    getActiveCatalog({ organizationId: organization.id }),
    getOptionalSessionProfileId(),
  ]);

  if (!apiKey) {
    return {
      ok: false,
      error:
        "AI recommendations are not configured yet. Add an OpenAI API key in Settings → Integrations → AI Assistant.",
    };
  }

  const allItems = [...catalog.bundles, ...catalog.aLaCarte, ...catalog.addons];
  if (allItems.length === 0) {
    return { ok: false, error: "No active catalog items are available yet." };
  }

  const modelResult = await askOpenAIForRecommendation({
    apiKey,
    model: model || DEFAULT_MODEL,
    description,
    context,
    catalogItems: allItems,
    realtorMemory: currentProfileId
      ? await loadRealtorMemory({
          organizationId: organization.id,
          profileId: currentProfileId,
          catalogItems: allItems,
        })
      : null,
  });

  const serviceSlugs = new Set(
    [...catalog.bundles, ...catalog.aLaCarte].map((item) => item.slug),
  );
  const addonsBySlug = new Map(catalog.addons.map((item) => [item.slug, item]));
  const services = unique(modelResult.services).filter((slug) =>
    serviceSlugs.has(slug),
  );
  const servicesBySlug = new Map(
    [...catalog.bundles, ...catalog.aLaCarte].map((item) => [item.slug, item]),
  );
  const selectedCapabilities = getSelectedServiceCapabilities(
    services.flatMap((slug) => {
      const item = servicesBySlug.get(slug);
      return item ? [item] : [];
    }),
  );
  const requestedAddOns = unique(modelResult.addOns);
  const addOns = requestedAddOns.filter((slug) => {
    const addon = addonsBySlug.get(slug);
    return Boolean(
      addon && isCatalogAddonEligible(addon, selectedCapabilities),
    );
  });

  if (services.length === 0) {
    return {
      ok: false,
      error:
        "I could not match that description to a live package. Try mentioning the home type, square footage, and whether they want photo, iGUIDE, video, or drone.",
    };
  }

  return {
    ok: true,
    recommendation: {
      services,
      addOns,
      title: modelResult.title.slice(0, 120),
      confidence: modelResult.confidence,
      reasoning: modelResult.reasoning.slice(0, 420),
      notes: [
        ...(addOns.length !== requestedAddOns.length
          ? ["An unavailable add-on was left out because it did not match the selected services."]
          : []),
        ...modelResult.notes,
      ]
        .map((note) => note.slice(0, 180))
        .slice(0, 5),
      missingInfo: unique(modelResult.missingInfo)
        .map((note) => note.slice(0, 120))
        .slice(0, 6),
      property: sanitizePropertyRecommendation(modelResult.property),
      memoryUsed: unique(modelResult.memoryUsed)
        .map((note) => note.slice(0, 160))
        .slice(0, 5),
    },
  };
}

async function askOpenAIForRecommendation(args: {
  apiKey: string;
  model: string;
  description: string;
  context: BookingRecommendationContext;
  catalogItems: CatalogItemRow[];
  realtorMemory: RealtorMemory | null;
}): Promise<ModelRecommendation> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      max_output_tokens: 700,
      input: [
        {
          role: "system",
          content:
            "You recommend real estate photography booking packages. Use only the provided catalog slugs. " +
            "Act like a booking concierge, not a generic chatbot. Pick the smallest package that confidently fits the listing, then add useful add-ons only when the user's description or realtor memory clearly supports them. " +
            "Consider square footage, whether the basement is included, property type, vacant/occupied state, luxury cues, video/social needs, drone/exterior value, and iGUIDE/floor-plan needs. " +
            "Use knownBookingDetails as facts already supplied in the booking form; do not ask for them again. Extract any new property details the realtor gave so the booking form can be prefilled. If a detail is missing, list it in missingInfo instead of pretending to know it. " +
            "Use realtorMemory only as a preference signal; do not expose private admin notes verbatim. " +
            "Do not invent packages, prices, addresses, postal codes, or slugs. Keep realtor-facing wording plain and helpful.",
        },
        {
          role: "user",
          content: JSON.stringify({
            listingDescription: args.description,
            knownBookingDetails: args.context,
            realtorMemory: args.realtorMemory,
            catalog: args.catalogItems.map((item) => ({
              slug: item.slug,
              name: item.name,
              kind: item.kind,
              description: item.description,
              priceCents: item.price_cents,
              durationMinutes: item.duration_minutes,
              isPhoto: item.is_photo,
              isVideo: item.is_video,
              requiresVideo: item.require_has_video,
              sqftPricingEnabled: item.sqft_pricing_enabled,
              includedSqft: item.included_sqft,
              overageIncrementSqft: item.overage_increment_sqft,
              overagePriceCents: item.overage_price_cents,
              idealFor: item.ideal_for,
            })),
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "booking_recommendation",
          strict: true,
          schema: RECOMMENDATION_SCHEMA,
        },
      },
    }),
  });

  const json = (await res.json()) as unknown;
  if (!res.ok) {
    throw new Error(openAiErrorMessage(json) ?? `OpenAI request failed (${res.status}).`);
  }

  const text = extractOutputText(json);
  if (!text) throw new Error("OpenAI returned no recommendation.");
  return JSON.parse(text) as ModelRecommendation;
}

const RECOMMENDATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "services",
    "addOns",
    "title",
    "confidence",
    "reasoning",
    "notes",
    "missingInfo",
    "property",
    "memoryUsed",
  ],
  properties: {
    services: {
      type: "array",
      items: { type: "string" },
    },
    addOns: {
      type: "array",
      items: { type: "string" },
    },
    title: { type: "string" },
    confidence: { type: "string", enum: ["strong", "good", "light"] },
    reasoning: { type: "string" },
    notes: {
      type: "array",
      items: { type: "string" },
    },
    missingInfo: {
      type: "array",
      items: { type: "string" },
    },
    property: {
      type: "object",
      additionalProperties: false,
      required: [
        "streetAddress",
        "city",
        "postalCode",
        "squareFootage",
        "isVacant",
        "includeBasement",
        "shootNotes",
        "shotRequests",
      ],
      properties: {
        streetAddress: { type: ["string", "null"] },
        city: { type: ["string", "null"] },
        postalCode: { type: ["string", "null"] },
        squareFootage: { type: ["number", "null"] },
        isVacant: {
          type: ["string", "null"],
          enum: ["vacant", "occupied", "partial", null],
        },
        includeBasement: { type: ["boolean", "null"] },
        shootNotes: { type: ["string", "null"] },
        shotRequests: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    memoryUsed: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

async function getOptionalSessionProfileId(): Promise<string | null> {
  const supabase = await getServerSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;

  try {
    const parts = session.access_token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { sub?: string; exp?: number };
    if (!payload.sub) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

async function loadRealtorMemory({
  organizationId,
  profileId,
  catalogItems,
}: {
  organizationId: string;
  profileId: string;
  catalogItems: CatalogItemRow[];
}): Promise<RealtorMemory | null> {
  const supabase = getServiceSupabase();
  const [{ data: profile }, { data: bookings }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, internal_notes, delivery_cc_emails, ai_memory")
      .eq("id", profileId)
      .eq("organization_id", organizationId)
      .eq("role", "realtor")
      .is("archived_at", null)
      .maybeSingle<MemoryProfileRow>(),
    supabase
      .from("bookings")
      .select(
        "id, scheduled_at, services, add_ons, square_footage, client_notes, properties(street_address, city, postal_code)",
      )
      .eq("owner_id", profileId)
      .eq("organization_id", organizationId)
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: false, nullsFirst: false })
      .limit(20)
      .returns<MemoryBookingRow[]>(),
  ]);

  if (!profile) return null;

  const catalogBySlug = new Map(catalogItems.map((item) => [item.slug, item.name]));
  const rows = bookings ?? [];
  const serviceCounts = countValues(rows.flatMap((booking) => booking.services));
  const addonCounts = countValues(rows.flatMap((booking) => booking.add_ons));
  const cityCounts = countValues(
    rows.map((booking) => booking.properties?.city ?? "").filter(Boolean),
  );
  const sqftValues = rows
    .map((booking) => booking.square_footage)
    .filter((value): value is number => typeof value === "number" && value > 0);
  const last = rows[0];
  const aiMemory = parseRealtorAIMemory(profile.ai_memory);

  return {
    profileName: profile.full_name ?? profile.email,
    email: profile.email,
    internalNotes: splitMemoryNotes(profile.internal_notes).slice(0, 6),
    deliveryCcCount: profile.delivery_cc_emails?.length ?? 0,
    commonServices: topValues(serviceCounts, 5).map(
      (slug) => catalogBySlug.get(slug) ?? slug,
    ),
    commonAddOns: topValues(addonCounts, 5).map(
      (slug) => catalogBySlug.get(slug) ?? slug,
    ),
    commonCities: topValues(cityCounts, 5),
    typicalSquareFootage:
      sqftValues.length > 0
        ? Math.round(
            sqftValues.reduce((sum, value) => sum + value, 0) /
              sqftValues.length,
          )
        : null,
    lastBooking: last
      ? [
          last.properties?.street_address,
          last.properties?.city,
          last.scheduled_at
            ? new Date(last.scheduled_at).toISOString().slice(0, 10)
            : null,
          [...last.services, ...last.add_ons].join(", "),
        ]
          .filter(Boolean)
          .join(" | ")
      : null,
    structuredMemory: mergeMemorySummaries(
      summarizeRealtorAIMemory(aiMemory),
      inferredMemorySummary({ rows, aiMemory, catalogBySlug }),
    ),
  };
}

function inferredMemorySummary({
  rows,
  aiMemory,
  catalogBySlug,
}: {
  rows: MemoryBookingRow[];
  aiMemory: RealtorAIMemory;
  catalogBySlug: Map<string, string>;
}): string[] {
  const items: string[] = [];
  const serviceCounts = countValues(rows.flatMap((booking) => booking.services));
  const addonCounts = countValues(rows.flatMap((booking) => booking.add_ons));
  const cityCounts = countValues(
    rows.map((booking) => booking.properties?.city ?? "").filter(Boolean),
  );
  if (!aiMemory.preferredServices.length) {
    const services = topValues(serviceCounts, 3).map(
      (slug) => catalogBySlug.get(slug) ?? slug,
    );
    if (services.length) items.push(`Usually books: ${services.join(", ")}`);
  }
  if (!aiMemory.preferredAddOns.length) {
    const addons = topValues(addonCounts, 3).map(
      (slug) => catalogBySlug.get(slug) ?? slug,
    );
    if (addons.length) items.push(`Common add-ons: ${addons.join(", ")}`);
  }
  if (!aiMemory.preferredCities.length) {
    const cities = topValues(cityCounts, 3);
    if (cities.length) items.push(`Common areas: ${cities.join(", ")}`);
  }
  return items;
}

function mergeMemorySummaries(primary: string[], fallback: string[]): string[] {
  return unique([...primary, ...fallback]).slice(0, 10);
}

function splitMemoryNotes(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/\n+|(?:^|\s)-\s+/)
    .map((note) => note.trim())
    .filter(Boolean);
}

function countValues(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function topValues(counts: Map<string, number>, limit: number): string[] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function sanitizePropertyRecommendation(
  property: ModelRecommendation["property"],
): BookingRecommendation["property"] {
  const squareFootage =
    typeof property.squareFootage === "number" &&
    Number.isFinite(property.squareFootage) &&
    property.squareFootage > 0
      ? Math.trunc(property.squareFootage)
      : null;
  return {
    streetAddress: cleanNullable(property.streetAddress, 120),
    city: cleanNullable(property.city, 80),
    postalCode: cleanNullable(property.postalCode, 20),
    squareFootage,
    isVacant: property.isVacant,
    includeBasement: property.includeBasement,
    shootNotes: cleanNullable(property.shootNotes, 500),
    shotRequests: unique(property.shotRequests)
      .map((shot) => shot.toLowerCase().replace(/[^a-z0-9_-]+/g, "_"))
      .filter(Boolean)
      .slice(0, 8),
  };
}

function sanitizeRecommendationContext(
  value: Partial<BookingRecommendationContext> | null | undefined,
): BookingRecommendationContext {
  const squareFootage =
    typeof value?.squareFootage === "number" &&
    Number.isFinite(value.squareFootage) &&
    value.squareFootage > 0
      ? Math.trunc(value.squareFootage)
      : null;
  return {
    selectedServices: unique(value?.selectedServices ?? []).slice(0, 20),
    selectedAddOns: unique(value?.selectedAddOns ?? []).slice(0, 20),
    streetAddress: cleanNullable(value?.streetAddress ?? null, 120),
    city: cleanNullable(value?.city ?? null, 80),
    postalCode: cleanNullable(value?.postalCode ?? null, 20),
    squareFootage,
    isVacant:
      value?.isVacant === "vacant" ||
      value?.isVacant === "occupied" ||
      value?.isVacant === "partial"
        ? value.isVacant
        : null,
    includeBasement:
      typeof value?.includeBasement === "boolean" ? value.includeBasement : null,
    shootNotes: cleanNullable(value?.shootNotes ?? null, 500),
    shotRequests: unique(value?.shotRequests ?? [])
      .map((shot) => shot.toLowerCase().replace(/[^a-z0-9_-]+/g, "_"))
      .filter(Boolean)
      .slice(0, 8),
  };
}

function cleanNullable(value: string | null, max: number): string | null {
  const clean = value?.trim();
  return clean ? clean.slice(0, max) : null;
}

function extractOutputText(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const direct = json as { output_text?: unknown; output?: unknown };
  if (typeof direct.output_text === "string") return direct.output_text;
  if (!Array.isArray(direct.output)) return null;

  for (const item of direct.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }
  return null;
}

function openAiErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const error = (json as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
