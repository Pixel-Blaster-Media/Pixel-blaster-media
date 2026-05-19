"use server";

import { requireUser } from "@/lib/auth/require-user";
import { labelForAddOn, labelForService } from "@/lib/booking/services";
import { getCredential } from "@/lib/integrations/credentials";
import { getServerSupabase } from "@/lib/supabase/server";
import type {
  BookingStatus,
  DeliverableSource,
  DeliverableType,
  Json,
} from "@/lib/supabase/database.types";

export type CopyKind =
  | "mls_description"
  | "instagram_caption"
  | "seller_email"
  | "listing_highlights";

export interface GenerateListingCopyResult {
  ok: boolean;
  text?: string;
  error?: string;
}

interface PropertyCopyRow {
  id: string;
  street_address: string;
  city: string | null;
  postal_code: string | null;
  notes: string | null;
  bookings: {
    id: string;
    status: BookingStatus;
    scheduled_at: string | null;
    services: string[];
    add_ons: string[];
    square_footage: number | null;
    client_notes: string | null;
    created_at: string;
  }[];
}

interface DeliverableCopyRow {
  type: DeliverableType;
  source: DeliverableSource;
  url: string;
  metadata: Json | null;
  ready_at: string | null;
}

export async function generateListingCopy(
  propertyId: string,
  kind: CopyKind,
): Promise<GenerateListingCopyResult> {
  const user = await requireUser(`/portal/${propertyId}`);

  const apiKey = await getCredential(
    "openai",
    "api_key",
    "OPENAI_API_KEY",
    user.organizationId,
  );
  if (!apiKey) {
    return {
      ok: false,
      error:
        "AI copy is not configured yet. Ask the admin to add an OpenAI API key in Settings → Integrations.",
    };
  }
  const model =
    (await getCredential(
      "openai",
      "model",
      "OPENAI_MODEL",
      user.organizationId,
    )) ||
    process.env.OPENAI_ASSISTANT_MODEL ||
    process.env.OPENAI_MODEL ||
    "gpt-5.4-mini";

  const supabase = await getServerSupabase();
  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select(
      "id, street_address, city, postal_code, notes, bookings(id, status, scheduled_at, services, add_ons, square_footage, client_notes, created_at)",
    )
    .eq("id", propertyId)
    .maybeSingle<PropertyCopyRow>();

  if (propertyError || !property) {
    return { ok: false, error: "Listing not found." };
  }

  const { data: deliverables } = await supabase
    .from("deliverables")
    .select("type, source, url, metadata, ready_at")
    .eq("property_id", propertyId)
    .returns<DeliverableCopyRow[]>();

  const context = buildPropertyContext(property, deliverables ?? []);
  const prompt = promptForKind(kind, context);

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content:
              "You write polished real estate marketing drafts for Canadian realtors. Use only supplied facts. Do not invent bedrooms, bathrooms, renovations, school zones, permits, legal uses, amenities, prices, or claims. Avoid fair-housing protected-class language. Keep copy editable and practical.",
          },
          { role: "user", content: prompt },
        ],
        max_output_tokens: 900,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return {
        ok: false,
        error: `AI request failed (${res.status}). ${body.slice(0, 180)}`,
      };
    }

    const data = (await res.json()) as { output_text?: string; output?: unknown };
    const text = extractOutputText(data);
    if (!text) return { ok: false, error: "AI returned an empty draft." };
    return { ok: true, text };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not generate copy.",
    };
  }
}

function buildPropertyContext(
  property: PropertyCopyRow,
  deliverables: DeliverableCopyRow[],
): string {
  const latest = pickLatest(property.bookings);
  const ready = deliverables.filter((d) => d.ready_at);
  const services = latest?.services.map(labelForService) ?? [];
  const addOns = latest?.add_ons.map(labelForAddOn) ?? [];
  const media = ready.map((d) => {
    const label = metadataString(d.metadata, "delivery_label");
    return [label ?? d.type, d.source].join(" via ");
  });

  return [
    `Address: ${property.street_address}`,
    `City/postal: ${[property.city, property.postal_code].filter(Boolean).join(" ") || "Not provided"}`,
    `Approx square footage: ${latest?.square_footage ? `${latest.square_footage} sqft` : "Not provided"}`,
    `Booking status: ${latest?.status ?? "Unknown"}`,
    `Services: ${services.length ? services.join(", ") : "Not provided"}`,
    `Add-ons: ${addOns.length ? addOns.join(", ") : "None"}`,
    `Ready media: ${media.length ? media.join(", ") : "No ready media yet"}`,
    `Property notes: ${property.notes || "None"}`,
    `Client notes: ${latest?.client_notes || "None"}`,
  ].join("\n");
}

function promptForKind(kind: CopyKind, context: string): string {
  const instructions: Record<CopyKind, string> = {
    mls_description:
      "Write one MLS-style listing description. 120-170 words. Professional, warm, no emoji, no bullet points. If facts are missing, keep it general rather than inventing.",
    instagram_caption:
      "Write an Instagram caption pack: one polished caption under 900 characters, 5 short hook options, and 8-12 relevant hashtags. Avoid overpromising.",
    seller_email:
      "Write a short email a realtor could send to the seller after media delivery. Include a clear subject line and friendly body. Mention that media is ready without claiming results.",
    listing_highlights:
      "Write concise listing highlights: 6 bullets for MLS/feature sheet use and 4 short social hooks. Use only provided facts.",
  };

  return `${instructions[kind]}\n\nListing context:\n${context}`;
}

function extractOutputText(data: { output_text?: string; output?: unknown }): string {
  if (typeof data.output_text === "string") return data.output_text.trim();
  if (!Array.isArray(data.output)) return "";
  const parts: string[] = [];
  for (const item of data.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("\n").trim();
}

function metadataString(metadata: Json | null | undefined, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function pickLatest(
  bookings: PropertyCopyRow["bookings"],
): PropertyCopyRow["bookings"][number] | null {
  if (!bookings || bookings.length === 0) return null;
  return [...bookings].sort((a, b) => {
    const aT = new Date(a.scheduled_at ?? a.created_at).getTime() || 0;
    const bT = new Date(b.scheduled_at ?? b.created_at).getTime() || 0;
    return bT - aT;
  })[0];
}
