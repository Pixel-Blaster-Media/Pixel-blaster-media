"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  BUSINESS_TZ,
  businessDateTimeLocalToUtc,
} from "@/lib/booking/availability";
import { loadBookingInternalNotes } from "@/lib/booking/internal-shoot-notes-server";
import { labelForAddOn, labelForService } from "@/lib/booking/services";
import { getCredential, saveCredentials } from "@/lib/integrations/credentials";
import {
  parseRealtorAIMemory,
  summarizeRealtorAIMemory,
} from "@/lib/realtors/memory";
import { getServiceSupabase } from "@/lib/supabase/server";
import type {
  BookingStatus,
  DeliverableSource,
  DeliverableType,
  Json,
} from "@/lib/supabase/database.types";
import {
  DEFAULT_TODAY_COMMAND_PREFERENCES,
  type TodayCommandPreferences,
} from "./preferences";

const FIELD = "today_command_preferences";
const DEFAULT_MODEL =
  process.env.OPENAI_ASSISTANT_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.4-mini";

interface TodayBookingRow {
  id: string;
  status: BookingStatus;
  scheduled_at: string | null;
  scheduled_ends_at: string | null;
  services: string[];
  add_ons: string[];
  square_footage: number | null;
  client_notes: string | null;
  unit_number: string | null;
  iguide_id: string | null;
  iguide_portal_id: string | null;
  properties: {
    street_address: string;
    city: string | null;
    province: string | null;
    postal_code: string | null;
  } | null;
  profiles: {
    full_name: string | null;
    email: string;
    phone: string | null;
    brokerage: string | null;
    internal_notes: string | null;
    delivery_cc_emails: string[] | null;
    ai_memory: Json | null;
  } | null;
}

interface TodayDeliverableRow {
  booking_id: string;
  type: DeliverableType;
  source: DeliverableSource;
  ready_at: string | null;
  metadata: { status?: string } | null;
}

export interface TodayAIBrief {
  overview: string;
  focus: string[];
  warnings: string[];
  routePlan: string[];
  perShoot: Array<{
    bookingId: string;
    title: string;
    time: string;
    address: string;
    realtor: string;
    bullets: string[];
  }>;
  afterShoot: string[];
}

export async function loadTodayCommandPreferences(
  organizationId: string,
): Promise<TodayCommandPreferences> {
  const raw = await getCredential("admin_settings", FIELD, "", organizationId);
  if (!raw) return DEFAULT_TODAY_COMMAND_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as Partial<TodayCommandPreferences>;
    return normalizePreferences(parsed);
  } catch {
    return DEFAULT_TODAY_COMMAND_PREFERENCES;
  }
}

export async function saveTodayCommandPreferences(
  formData: FormData,
): Promise<void> {
  const admin = await requireAdmin();
  const preferences: TodayCommandPreferences = {
    showDeliverables: formData.get("show_deliverables") === "on",
    showAgentMemory: formData.get("show_agent_memory") === "on",
    showRouteWarnings: formData.get("show_route_warnings") === "on",
    showBookingNotes: formData.get("show_booking_notes") === "on",
    showShootBrief: formData.get("show_shoot_brief") === "on",
  };

  await saveCredentials(
    "admin_settings",
    { [FIELD]: JSON.stringify(preferences) },
    admin.userId,
    admin.organizationId,
  );
  revalidatePath("/admin/today");
  revalidatePath("/admin/settings");
}

export async function generateTodayAIBrief(): Promise<
  { ok: true; brief: TodayAIBrief } | { ok: false; error: string }
> {
  const admin = await requireAdmin();
  const [apiKey, model] = await Promise.all([
    getCredential("openai", "api_key", "OPENAI_API_KEY", admin.organizationId),
    getCredential("openai", "model", "OPENAI_ASSISTANT_MODEL", admin.organizationId),
  ]);
  if (!apiKey) {
    return {
      ok: false,
      error:
        "AI is not configured yet. Add an OpenAI API key in Settings → Integrations → AI Assistant.",
    };
  }

  const todayKey = localDateKey(new Date());
  const start = businessDateTimeLocalToUtc(`${todayKey}T00:00`);
  const end = businessDateTimeLocalToUtc(`${addDaysKey(todayKey, 1)}T00:00`);
  if (!start || !end) return { ok: false, error: "Could not read today's date." };

  const supabase = getServiceSupabase();
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select(
      "id, status, scheduled_at, scheduled_ends_at, services, add_ons, square_footage, client_notes, unit_number, iguide_id, iguide_portal_id, properties(street_address, city, province, postal_code), profiles(full_name, email, phone, brokerage, internal_notes, delivery_cc_emails, ai_memory)",
    )
    .eq("organization_id", admin.organizationId)
    .not("scheduled_at", "is", null)
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString())
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: true })
    .returns<TodayBookingRow[]>();

  if (error) return { ok: false, error: error.message };
  const rows = bookings ?? [];
  if (rows.length === 0) {
    return {
      ok: true,
      brief: {
        overview: "No shoots are scheduled today.",
        focus: ["Use the quiet day to check outstanding deliveries and tomorrow's route."],
        warnings: [],
        routePlan: [],
        perShoot: [],
        afterShoot: ["Review any pending media links before the next shoot day."],
      },
    };
  }

  const bookingIds = rows.map((booking) => booking.id);
  const privateNotesByBooking = await loadBookingInternalNotes({
    organizationId: admin.organizationId,
    actorId: admin.userId,
    bookingIds,
  });
  const { data: deliverables } =
    bookingIds.length > 0
      ? await supabase
          .from("deliverables")
          .select("booking_id, type, source, ready_at, metadata")
          .in("booking_id", bookingIds)
          .returns<TodayDeliverableRow[]>()
      : { data: [] as TodayDeliverableRow[] };

  const deliverablesByBooking = new Map<string, TodayDeliverableRow[]>();
  for (const deliverable of deliverables ?? []) {
    deliverablesByBooking.set(deliverable.booking_id, [
      ...(deliverablesByBooking.get(deliverable.booking_id) ?? []),
      deliverable,
    ]);
  }

  try {
    const brief = await askOpenAIForTodayBrief({
      apiKey,
      model: model || DEFAULT_MODEL,
      todayLabel: formatFullDate(start),
      shoots: rows.map((booking, index) =>
        buildShootContextLine(
          booking,
          rows[index + 1] ?? null,
          deliverablesByBooking.get(booking.id) ?? [],
          privateNotesByBooking.get(booking.id)?.notes ?? null,
        ),
      ),
    });
    return { ok: true, brief: sanitizeBrief(brief, rows) };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Could not generate today's AI brief.",
    };
  }
}

function normalizePreferences(
  input: Partial<TodayCommandPreferences>,
): TodayCommandPreferences {
  return {
    showDeliverables:
      typeof input.showDeliverables === "boolean"
        ? input.showDeliverables
        : DEFAULT_TODAY_COMMAND_PREFERENCES.showDeliverables,
    showAgentMemory:
      typeof input.showAgentMemory === "boolean"
        ? input.showAgentMemory
        : DEFAULT_TODAY_COMMAND_PREFERENCES.showAgentMemory,
    showRouteWarnings:
      typeof input.showRouteWarnings === "boolean"
        ? input.showRouteWarnings
        : DEFAULT_TODAY_COMMAND_PREFERENCES.showRouteWarnings,
    showBookingNotes:
      typeof input.showBookingNotes === "boolean"
        ? input.showBookingNotes
        : DEFAULT_TODAY_COMMAND_PREFERENCES.showBookingNotes,
    showShootBrief:
      typeof input.showShootBrief === "boolean"
        ? input.showShootBrief
        : DEFAULT_TODAY_COMMAND_PREFERENCES.showShootBrief,
  };
}

async function askOpenAIForTodayBrief({
  apiKey,
  model,
  todayLabel,
  shoots,
}: {
  apiKey: string;
  model: string;
  todayLabel: string;
  shoots: string[];
}): Promise<TodayAIBrief> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 900,
      input: [
        {
          role: "system",
          content:
            "You write practical same-day briefs for a real estate photographer. " +
            "Use only the provided schedule data. Do not upsell. Do not invent weather, travel times, access codes, or missing links. " +
            "Focus on what to prepare, what to watch for, route timing, client preferences, delivery risks, and after-shoot tasks. " +
            "Keep it concise, calm, and operational.",
        },
        {
          role: "user",
          content: JSON.stringify({
            date: todayLabel,
            timezone: BUSINESS_TZ,
            shoots,
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "today_ai_brief",
          strict: true,
          schema: TODAY_BRIEF_SCHEMA,
        },
      },
    }),
  });
  const json = (await res.json()) as unknown;
  if (!res.ok) {
    throw new Error(openAiErrorMessage(json) ?? `OpenAI request failed (${res.status}).`);
  }
  const text = extractOutputText(json);
  if (!text) throw new Error("OpenAI returned no daily brief.");
  return JSON.parse(text) as TodayAIBrief;
}

const TODAY_BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overview", "focus", "warnings", "routePlan", "perShoot", "afterShoot"],
  properties: {
    overview: { type: "string" },
    focus: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    routePlan: { type: "array", items: { type: "string" } },
    perShoot: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId", "title", "time", "address", "realtor", "bullets"],
        properties: {
          bookingId: { type: "string" },
          title: { type: "string" },
          time: { type: "string" },
          address: { type: "string" },
          realtor: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
        },
      },
    },
    afterShoot: { type: "array", items: { type: "string" } },
  },
} as const;

function buildShootContextLine(
  booking: TodayBookingRow,
  nextBooking: TodayBookingRow | null,
  deliverables: TodayDeliverableRow[],
  privateShootNotes: string | null,
): string {
  const services = [...booking.services.map(labelForService), ...booking.add_ons.map(labelForAddOn)];
  const profile = booking.profiles;
  const memory = profile?.ai_memory
    ? summarizeRealtorAIMemory(parseRealtorAIMemory(profile.ai_memory)).join("; ")
    : "";
  return [
    `bookingId=${booking.id}`,
    `time=${booking.scheduled_at ? formatTime(booking.scheduled_at) : "not timed"}`,
    `ends=${booking.scheduled_ends_at ? formatTime(booking.scheduled_ends_at) : ""}`,
    `address=${fullAddress(booking) || "Unknown address"}`,
    `realtor=${profile?.full_name ?? profile?.email ?? "Unknown"}`,
    `phone=${profile?.phone ?? ""}`,
    `brokerage=${profile?.brokerage ?? ""}`,
    `services=${services.join(", ") || "none"}`,
    `sqft=${booking.square_footage ?? ""}`,
    `clientNotes=${booking.client_notes ?? ""}`,
    `internalNotes=${privateShootNotes ?? ""}`,
    `agentNotes=${profile?.internal_notes ?? ""}`,
    `structuredMemory=${memory}`,
    `deliveryCCCount=${profile?.delivery_cc_emails?.length ?? 0}`,
    `deliveryTasks=${deliveryTaskLabels(booking, deliverables).join(", ")}`,
    `nextGap=${nextGapLabel(booking, nextBooking)}`,
  ].join(" | ");
}

function deliveryTaskLabels(
  booking: TodayBookingRow,
  deliverables: TodayDeliverableRow[],
): string[] {
  const hasPhotosReady = deliverables.some(
    (d) => d.source !== "fotello" && d.type === "photo_gallery" && d.ready_at,
  );
  const hasIGuideReady = deliverables.some(
    (d) => d.source === "iguide" && d.type === "virtual_tour" && d.ready_at,
  );
  const hasFloorPlanReady = deliverables.some(
    (d) => d.type === "floor_plan" && d.ready_at,
  );
  const hasVideoReady = deliverables.some(
    (d) => (d.type === "video" || d.type === "aerial") && d.ready_at,
  );
  return [
    hasPhotosReady ? "photos ready" : "photos not linked",
    hasIGuideReady
      ? "iGUIDE ready"
      : booking.iguide_id || booking.iguide_portal_id
        ? "iGUIDE linked but not ready"
        : "iGUIDE not linked",
    hasFloorPlanReady ? "floor plans ready" : "floor plans pending",
    hasVideoReady ? "video ready" : "video pending",
  ];
}

function nextGapLabel(
  booking: TodayBookingRow,
  nextBooking: TodayBookingRow | null,
): string {
  if (!booking.scheduled_at || !nextBooking?.scheduled_at) return "";
  const currentEnd = booking.scheduled_ends_at ?? booking.scheduled_at;
  const gapMinutes = Math.round(
    (new Date(nextBooking.scheduled_at).getTime() -
      new Date(currentEnd).getTime()) /
      60000,
  );
  return `${gapMinutes} min before ${nextBooking.properties?.street_address ?? "next shoot"}`;
}

function sanitizeBrief(brief: TodayAIBrief, bookings: TodayBookingRow[]): TodayAIBrief {
  const ids = new Set(bookings.map((booking) => booking.id));
  return {
    overview: cleanText(brief.overview, 360) || "Today is ready.",
    focus: cleanList(brief.focus, 5, 180),
    warnings: cleanList(brief.warnings, 5, 180),
    routePlan: cleanList(brief.routePlan, 5, 180),
    perShoot: brief.perShoot
      .filter((shoot) => ids.has(shoot.bookingId))
      .slice(0, 8)
      .map((shoot) => ({
        bookingId: shoot.bookingId,
        title: cleanText(shoot.title, 120) || "Shoot brief",
        time: cleanText(shoot.time, 40) || "",
        address: cleanText(shoot.address, 140) || "Unknown address",
        realtor: cleanText(shoot.realtor, 120) || "Realtor",
        bullets: cleanList(shoot.bullets, 5, 180),
      })),
    afterShoot: cleanList(brief.afterShoot, 5, 180),
  };
}

function cleanList(values: string[], limit: number, maxLength: number): string[] {
  return Array.from(new Set(values.map((value) => cleanText(value, maxLength)).filter(Boolean))).slice(0, limit);
}

function cleanText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function fullAddress(booking: TodayBookingRow): string {
  return [
    booking.properties?.street_address,
    booking.unit_number ? `Unit ${booking.unit_number}` : null,
    booking.properties?.city,
    booking.properties?.province,
    booking.properties?.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
}

function localDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDaysKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatFullDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
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
