"use server";

import { getActiveCatalog, type CatalogItemRow } from "@/lib/booking/catalog";
import { getCredential } from "@/lib/integrations/credentials";
import { resolvePublicBookingOrganization } from "@/lib/organizations/public-booking";

const DEFAULT_MODEL =
  process.env.OPENAI_ASSISTANT_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.4-mini";

export interface BookingRecommendation {
  services: string[];
  addOns: string[];
  title: string;
  confidence: "strong" | "good" | "light";
  reasoning: string;
  notes: string[];
}

interface ModelRecommendation {
  services: string[];
  addOns: string[];
  title: string;
  confidence: "strong" | "good" | "light";
  reasoning: string;
  notes: string[];
}

export async function recommendBookingPackage(input: {
  description: string;
  organizationSlug?: string | null;
}): Promise<{ ok: true; recommendation: BookingRecommendation } | { ok: false; error: string }> {
  const description = input.description.trim().slice(0, 1600);
  if (description.length < 8) {
    return { ok: false, error: "Add a little more detail first." };
  }

  const organization = await resolvePublicBookingOrganization(input.organizationSlug);
  if (!organization) return { ok: false, error: "Could not find that booking company." };

  const [apiKey, model, catalog] = await Promise.all([
    getCredential("openai", "api_key", "OPENAI_API_KEY", organization.id),
    getCredential("openai", "model", "OPENAI_ASSISTANT_MODEL", organization.id),
    getActiveCatalog({ organizationId: organization.id }),
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
    catalogItems: allItems,
  });

  const serviceSlugs = new Set(
    [...catalog.bundles, ...catalog.aLaCarte].map((item) => item.slug),
  );
  const addonSlugs = new Set(catalog.addons.map((item) => item.slug));
  const services = unique(modelResult.services).filter((slug) =>
    serviceSlugs.has(slug),
  );
  const addOns = unique(modelResult.addOns).filter((slug) => addonSlugs.has(slug));

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
      notes: modelResult.notes.map((note) => note.slice(0, 180)).slice(0, 5),
    },
  };
}

async function askOpenAIForRecommendation(args: {
  apiKey: string;
  model: string;
  description: string;
  catalogItems: CatalogItemRow[];
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
            "Pick the smallest package that confidently fits the listing, then add useful add-ons only when the user's description clearly supports them. " +
            "Consider square footage, whether the basement is included, property type, vacant/occupied state, luxury cues, video/social needs, drone/exterior value, and iGUIDE/floor-plan needs. " +
            "Do not invent packages, prices, or slugs. Keep realtor-facing wording plain and helpful.",
        },
        {
          role: "user",
          content: JSON.stringify({
            listingDescription: args.description,
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
  required: ["services", "addOns", "title", "confidence", "reasoning", "notes"],
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
  },
} as const;

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
