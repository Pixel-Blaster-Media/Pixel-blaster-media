import type { Json } from "@/lib/supabase/database.types";

export interface RealtorAIMemory {
  preferredServices: string[];
  preferredAddOns: string[];
  preferredCities: string[];
  typicalSquareFootage: number | null;
  deliveryPreferences: string[];
  communicationStyle: string | null;
  accessNotes: string[];
  invoicePreferences: string | null;
  avoidReminders: string[];
}

export const EMPTY_REALTOR_AI_MEMORY: RealtorAIMemory = {
  preferredServices: [],
  preferredAddOns: [],
  preferredCities: [],
  typicalSquareFootage: null,
  deliveryPreferences: [],
  communicationStyle: null,
  accessNotes: [],
  invoicePreferences: null,
  avoidReminders: [],
};

export function parseRealtorAIMemory(value: Json | null | undefined): RealtorAIMemory {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return EMPTY_REALTOR_AI_MEMORY;
  }
  const record = value as Record<string, Json | undefined>;
  return {
    preferredServices: stringList(record.preferredServices),
    preferredAddOns: stringList(record.preferredAddOns),
    preferredCities: stringList(record.preferredCities),
    typicalSquareFootage: positiveInt(record.typicalSquareFootage),
    deliveryPreferences: stringList(record.deliveryPreferences),
    communicationStyle: nullableString(record.communicationStyle, 240),
    accessNotes: stringList(record.accessNotes),
    invoicePreferences: nullableString(record.invoicePreferences, 240),
    avoidReminders: stringList(record.avoidReminders),
  };
}

export function realtorAIMemoryToJson(memory: RealtorAIMemory): Json {
  return {
    preferredServices: cleanList(memory.preferredServices, 12),
    preferredAddOns: cleanList(memory.preferredAddOns, 12),
    preferredCities: cleanList(memory.preferredCities, 12),
    typicalSquareFootage: memory.typicalSquareFootage,
    deliveryPreferences: cleanList(memory.deliveryPreferences, 12),
    communicationStyle: cleanNullable(memory.communicationStyle, 240),
    accessNotes: cleanList(memory.accessNotes, 12),
    invoicePreferences: cleanNullable(memory.invoicePreferences, 240),
    avoidReminders: cleanList(memory.avoidReminders, 12),
  };
}

export function summarizeRealtorAIMemory(memory: RealtorAIMemory): string[] {
  const items: string[] = [];
  if (memory.preferredServices.length) {
    items.push(`Usually books: ${memory.preferredServices.join(", ")}`);
  }
  if (memory.preferredAddOns.length) {
    items.push(`Common add-ons: ${memory.preferredAddOns.join(", ")}`);
  }
  if (memory.preferredCities.length) {
    items.push(`Common areas: ${memory.preferredCities.join(", ")}`);
  }
  if (memory.typicalSquareFootage) {
    items.push(`Typical size: ${memory.typicalSquareFootage.toLocaleString()} sqft`);
  }
  if (memory.deliveryPreferences.length) {
    items.push(`Delivery: ${memory.deliveryPreferences.join(", ")}`);
  }
  if (memory.communicationStyle) {
    items.push(`Communication: ${memory.communicationStyle}`);
  }
  if (memory.accessNotes.length) {
    items.push(`Access: ${memory.accessNotes.join(", ")}`);
  }
  if (memory.invoicePreferences) {
    items.push(`Invoice: ${memory.invoicePreferences}`);
  }
  if (memory.avoidReminders.length) {
    items.push(`Do not remind: ${memory.avoidReminders.join(", ")}`);
  }
  return items;
}

function stringList(value: Json | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return cleanList(
    value.filter((item): item is string => typeof item === "string"),
    12,
  );
}

function positiveInt(value: Json | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.trunc(value);
}

function nullableString(value: Json | undefined, max: number): string | null {
  return typeof value === "string" ? cleanNullable(value, max) : null;
}

function cleanList(values: string[], limit: number): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  )
    .map((value) => value.slice(0, 120))
    .slice(0, limit);
}

function cleanNullable(value: string | null, max: number): string | null {
  const clean = value?.trim();
  return clean ? clean.slice(0, max) : null;
}
