"use server";

import { revalidatePath } from "next/cache";

import {
  sendDeliveryReadyEmail,
  updateBookingStatus,
} from "@/app/admin/bookings/[id]/actions";
import { createAdminShoot } from "@/app/admin/calendar/actions";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  isCancellable,
  nextBookingStatuses,
} from "@/lib/booking/booking-status";
import { cancelBooking } from "@/lib/booking/cancel";
import {
  computeCartTotals,
  getActiveCatalog,
  validateCart,
  type Catalog,
  type CatalogItemRow,
} from "@/lib/booking/catalog";
import { labelForAddOn, labelForService } from "@/lib/booking/services";
import { getCredential } from "@/lib/integrations/credentials";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { BookingStatus } from "@/lib/supabase/database.types";

const DEFAULT_MODEL =
  process.env.OPENAI_ASSISTANT_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
const BUSINESS_TZ = "America/Toronto";

export interface AdminAssistantAction {
  type:
    | "cancel_booking"
    | "create_booking"
    | "open_booking"
    | "draft_booking"
    | "update_booking_status"
    | "send_delivery_email";
  bookingId: string;
  label: string;
  details: string;
  href: string;
  destructive: boolean;
  requiresConfirmation: boolean;
  nextStatus?: BookingStatus;
  draft?: AdminAssistantBookingDraft;
}

export interface AdminAssistantResult {
  ok: boolean;
  message: string;
  kind: "answer" | "needs_confirmation" | "needs_clarification" | "unsupported";
  actions: AdminAssistantAction[];
  error?: string;
}

export interface AdminAssistantBookingDraft {
  sourceBookingId: string;
  scheduledLocal: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  brokerage: string;
  streetAddress: string;
  unitNumber: string;
  city: string;
  province: string;
  postalCode: string;
  squareFootage: string;
  notes: string;
  catalogItemIds: string[];
}

interface BookingContextRow {
  id: string;
  status: BookingStatus;
  scheduled_at: string | null;
  scheduled_ends_at: string | null;
  services: string[];
  add_ons: string[];
  square_footage: number | null;
  unit_number: string | null;
  client_notes: string | null;
  properties: {
    street_address: string;
    city: string | null;
    postal_code: string | null;
  } | null;
  profiles: {
    id: string;
    full_name: string | null;
    email: string;
    phone: string | null;
    brokerage: string | null;
    internal_notes: string | null;
    delivery_cc_emails: string[] | null;
  } | null;
}

interface BookingLineContextRow {
  booking_id: string;
  catalog_item_id: string;
  quantity: number;
}

interface ProfileContextRow {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  brokerage: string | null;
  internal_notes: string | null;
  delivery_cc_emails: string[] | null;
}

interface DeliverableContextRow {
  booking_id: string;
  type: string;
  source: string;
  ready_at: string | null;
}

interface ModelPlan {
  kind: AdminAssistantResult["kind"];
  message: string;
  actions: Array<{
    type:
      | "cancel_booking"
      | "create_booking"
      | "open_booking"
      | "draft_booking"
      | "update_booking_status"
      | "send_delivery_email"
      | "none";
    bookingId: string;
    label: string;
    details: string;
    nextStatus: string;
    draft: {
      sourceBookingId: string;
      scheduledLocal: string;
      contactName: string;
      contactEmail: string;
      contactPhone: string;
      brokerage: string;
      streetAddress: string;
      unitNumber: string;
      city: string;
      province: string;
      postalCode: string;
      squareFootage: string;
      notes: string;
      catalogItemIds: string[];
      useSourceProperty: boolean;
    };
  }>;
  missing: string[];
}

export async function askAdminAssistant(
  prompt: string,
): Promise<AdminAssistantResult> {
  const admin = await requireAdmin();

  const request = prompt.trim();
  if (request.length < 3) {
    return {
      ok: false,
      kind: "needs_clarification",
      message: "Tell me what you want to do, like cancel a booking or find a realtor.",
      actions: [],
    };
  }

  const aiConfig = await getAssistantAIConfig(admin.organizationId);
  if (!aiConfig.apiKey) {
    return {
      ok: false,
      kind: "unsupported",
      message:
        "The AI assistant needs an OpenAI API key. Add one in Settings → Integrations → AI Assistant.",
      actions: [],
    };
  }
  const openAiConfig = { apiKey: aiConfig.apiKey, model: aiConfig.model };

  const context = await loadAssistantContext(admin.organizationId);
  const modelPlan = await planWithOpenAI(request, context, openAiConfig);
  return normalizePlan(modelPlan, context);
}

export async function confirmAdminAssistantAction(
  action: AdminAssistantAction,
): Promise<AdminAssistantResult> {
  const admin = await requireAdmin();

  if (action.type === "create_booking") {
    return createBookingFromAssistant(action);
  }

  if (action.type === "send_delivery_email") {
    const result = await sendDeliveryReadyEmail(action.bookingId);
    if (!result.ok) {
      return {
        ok: false,
        kind: "needs_clarification",
        message: result.error ?? "I couldn't send that delivery email.",
        actions: [],
      };
    }
    return {
      ok: true,
      kind: "answer",
      message: `Done. I ${result.resent ? "resent" : "sent"} the delivery email to ${result.recipientCount ?? 1} recipient${(result.recipientCount ?? 1) === 1 ? "" : "s"}.`,
      actions: [
        {
          type: "open_booking",
          bookingId: action.bookingId,
          label: "Open booking",
          details: "Review the delivered media and email recipients.",
          href: `/admin/bookings/${action.bookingId}?tab=delivery`,
          destructive: false,
          requiresConfirmation: false,
        },
      ],
    };
  }

  if (action.type === "update_booking_status") {
    if (!action.nextStatus) {
      return {
        ok: false,
        kind: "needs_clarification",
        message: "I need the next status before I can update that booking.",
        actions: [],
      };
    }
    const result = await updateBookingStatus(action.bookingId, action.nextStatus);
    if (!result.ok) {
      return {
        ok: false,
        kind: "needs_clarification",
        message: result.error ?? "I couldn't update that booking status.",
        actions: [],
      };
    }
    revalidatePath("/admin/today");
    revalidatePath("/admin/calendar");
    return {
      ok: true,
      kind: "answer",
      message: `Done. I moved the booking to ${action.nextStatus}.`,
      actions: [
        {
          type: "open_booking",
          bookingId: action.bookingId,
          label: "Open booking",
          details: "Review the updated booking.",
          href: `/admin/bookings/${action.bookingId}`,
          destructive: false,
          requiresConfirmation: false,
        },
      ],
    };
  }

  if (action.type !== "cancel_booking") {
    return {
      ok: false,
      kind: "unsupported",
      message: "This action is not executable yet.",
      actions: [],
    };
  }

  const supabase = getServiceSupabase();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, status")
    .eq("organization_id", admin.organizationId)
    .eq("id", action.bookingId)
    .single<{ id: string; status: BookingStatus }>();

  if (error || !booking) {
    return {
      ok: false,
      kind: "needs_clarification",
      message: "I couldn't find that booking anymore. It may have changed.",
      actions: [],
    };
  }

  if (!isCancellable(booking.status)) {
    return {
      ok: false,
      kind: "unsupported",
      message: `That booking is ${booking.status}, so it can't be cancelled with the quick assistant.`,
      actions: [],
    };
  }

  const result = await cancelBooking(booking.id, "admin");
  if (!result.ok) {
    return {
      ok: false,
      kind: "needs_clarification",
      message: result.error ?? "Cancel failed.",
      actions: [],
    };
  }

  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${booking.id}`);
  revalidatePath("/admin/calendar");

  return {
    ok: true,
    kind: "answer",
    message:
      "Done. I cancelled the booking, emailed the realtor, removed the Google Calendar event if one existed, and freed the slot.",
    actions: [
      {
        type: "open_booking",
        bookingId: booking.id,
        label: "Open cancelled booking",
        details: "Review the cancelled booking.",
        href: `/admin/bookings/${booking.id}`,
        destructive: false,
        requiresConfirmation: false,
      },
    ],
  };
}

async function loadAssistantContext(organizationId: string): Promise<{
  nowLocal: string;
  bookings: string[];
  realtors: string[];
  knownAddresses: string[];
  bookingsById: Map<string, BookingContextRow>;
  lineItemIdsByBookingId: Map<string, string[]>;
  catalog: Catalog;
  catalogItemsById: Map<string, CatalogItemRow>;
  catalogItemsBySlug: Map<string, CatalogItemRow>;
  catalogLines: string[];
}> {
  const supabase = getServiceSupabase();
  const now = new Date();
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60_000);
  const ninetyDaysAhead = new Date(now.getTime() + 90 * 24 * 60 * 60_000);

  const [bookingRes, realtorRes, catalog] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "id, status, scheduled_at, scheduled_ends_at, services, add_ons, square_footage, unit_number, client_notes, properties(street_address, city, postal_code), profiles(id, full_name, email, phone, brokerage, internal_notes, delivery_cc_emails)",
      )
      .eq("organization_id", organizationId)
      .gte("scheduled_at", oneYearAgo.toISOString())
      .lte("scheduled_at", ninetyDaysAhead.toISOString())
      .order("scheduled_at", { ascending: true, nullsFirst: false })
      .limit(120)
      .returns<BookingContextRow[]>(),
    supabase
      .from("profiles")
      .select("id, full_name, email, phone, brokerage, internal_notes, delivery_cc_emails")
      .eq("organization_id", organizationId)
      .eq("role", "realtor")
      .order("full_name", { ascending: true, nullsFirst: false })
      .limit(80)
      .returns<ProfileContextRow[]>(),
    getActiveCatalog({ organizationId }),
  ]);

  if (bookingRes.error) {
    throw new Error(`Could not load bookings for assistant: ${bookingRes.error.message}`);
  }
  if (realtorRes.error) {
    throw new Error(`Could not load realtors for assistant: ${realtorRes.error.message}`);
  }

  const bookingRows = bookingRes.data ?? [];
  const bookingIds = bookingRows.map((booking) => booking.id);
  const lineItemIdsByBookingId = new Map<string, string[]>();
  if (bookingIds.length > 0) {
    const { data: lineItems, error: lineItemError } = await supabase
      .from("booking_line_items")
      .select("booking_id, catalog_item_id, quantity")
      .in("booking_id", bookingIds)
      .returns<BookingLineContextRow[]>();
    if (lineItemError) {
      throw new Error(
        `Could not load booking line items for assistant: ${lineItemError.message}`,
      );
    }
    for (const line of lineItems ?? []) {
      const list = lineItemIdsByBookingId.get(line.booking_id) ?? [];
      list.push(line.catalog_item_id);
      lineItemIdsByBookingId.set(line.booking_id, list);
    }
  }

  const deliverablesByBookingId = new Map<string, DeliverableContextRow[]>();
  if (bookingIds.length > 0) {
    const { data: deliverables, error: deliverableError } = await supabase
      .from("deliverables")
      .select("booking_id, type, source, ready_at")
      .in("booking_id", bookingIds)
      .returns<DeliverableContextRow[]>();
    if (deliverableError) {
      throw new Error(
        `Could not load deliverables for assistant: ${deliverableError.message}`,
      );
    }
    for (const deliverable of deliverables ?? []) {
      deliverablesByBookingId.set(deliverable.booking_id, [
        ...(deliverablesByBookingId.get(deliverable.booking_id) ?? []),
        deliverable,
      ]);
    }
  }

  const allCatalogItems = [
    ...catalog.bundles,
    ...catalog.aLaCarte,
    ...catalog.addons,
  ];
  const catalogItemsById = new Map(allCatalogItems.map((item) => [item.id, item]));
  const catalogItemsBySlug = new Map(
    allCatalogItems.map((item) => [item.slug, item]),
  );
  const catalogLines = allCatalogItems.map((item) =>
    [
      `id=${item.id}`,
      `slug=${item.slug}`,
      `kind=${item.kind}`,
      `name=${item.name}`,
      `duration=${item.duration_minutes}m`,
      `price=${item.price_cents / 100}`,
    ].join(" | "),
  );

  const bookingsById = new Map<string, BookingContextRow>();
  const bookings = bookingRows.map((booking) => {
    bookingsById.set(booking.id, booking);
    const address = [
      booking.properties?.street_address,
      booking.unit_number ? `Unit ${booking.unit_number}` : null,
      booking.properties?.city,
      booking.properties?.postal_code,
    ]
      .filter(Boolean)
      .join(", ");
    const realtor =
      booking.profiles?.full_name ?? booking.profiles?.email ?? "Unknown realtor";
    const services = [
      ...booking.services.map(labelForService),
      ...booking.add_ons.map(labelForAddOn),
    ].join(", ");
    const deliverables = deliverablesByBookingId.get(booking.id) ?? [];
    const readyDeliverables = deliverables
      .filter((deliverable) => deliverable.ready_at)
      .map((deliverable) => `${deliverable.source}:${deliverable.type}`)
      .join(",");
    const pendingDeliverables = deliverables
      .filter((deliverable) => !deliverable.ready_at)
      .map((deliverable) => `${deliverable.source}:${deliverable.type}`)
      .join(",");
    return [
      `id=${booking.id}`,
      `status=${booking.status}`,
      `when=${booking.scheduled_at ? formatLocal(booking.scheduled_at) : "not scheduled"}`,
      `realtor=${realtor}`,
      `email=${booking.profiles?.email ?? ""}`,
      `address=${address || "Unknown address"}`,
      `sqft=${booking.square_footage ?? ""}`,
      `services=${services || "none"}`,
      `catalogItemIds=${(lineItemIdsByBookingId.get(booking.id) ?? []).join(",")}`,
      `legacyServiceIds=${booking.services.join(",")}`,
      `legacyAddOnIds=${booking.add_ons.join(",")}`,
      `readyDeliverables=${readyDeliverables || "none"}`,
      `pendingDeliverables=${pendingDeliverables || "none"}`,
      `notes=${booking.client_notes ?? ""}`,
      `agentMemory=${booking.profiles?.internal_notes ?? ""}`,
      `deliveryCCs=${(booking.profiles?.delivery_cc_emails ?? []).join(",")}`,
    ].join(" | ");
  });
  const knownAddresses = unique(
    bookingRows
      .map((booking) =>
        [
          booking.properties?.street_address,
          booking.unit_number ? `Unit ${booking.unit_number}` : null,
          booking.properties?.city,
          booking.properties?.postal_code,
        ]
          .filter(Boolean)
          .join(", "),
      )
      .filter(Boolean),
  ).slice(0, 80);

  const realtors = (realtorRes.data ?? []).map((realtor) =>
    [
      `id=${realtor.id}`,
      `name=${realtor.full_name ?? ""}`,
      `email=${realtor.email}`,
      `phone=${realtor.phone ?? ""}`,
      `brokerage=${realtor.brokerage ?? ""}`,
      `agentMemory=${realtor.internal_notes ?? ""}`,
      `deliveryCCs=${(realtor.delivery_cc_emails ?? []).join(",")}`,
    ].join(" | "),
  );

  return {
    nowLocal: formatLocal(now.toISOString()),
    bookings,
    realtors,
    knownAddresses,
    bookingsById,
    lineItemIdsByBookingId,
    catalog,
    catalogItemsById,
    catalogItemsBySlug,
    catalogLines,
  };
}

async function planWithOpenAI(
  request: string,
  context: {
    nowLocal: string;
    bookings: string[];
    realtors: string[];
    knownAddresses: string[];
    catalogLines: string[];
  },
  aiConfig: { apiKey: string; model: string },
): Promise<ModelPlan> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${aiConfig.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: aiConfig.model,
      max_output_tokens: 900,
      input: [
        {
          role: "system",
          content:
            "You are Pixel Assistant, an admin assistant for a real estate photography booking system. " +
            "Use only the provided booking and realtor context. The business timezone is America/Toronto. " +
            "Never claim you changed data. For any change, propose an action for confirmation. " +
            "Only propose cancel_booking when exactly one cancellable booking is clearly identified. " +
            "Only propose send_delivery_email when one booking is clearly identified and the user asks to send, resend, or deliver media. " +
            "Only propose update_booking_status when one booking and the exact next status are clearly identified; use requested, confirmed, shot, editing, delivered, or cancelled only. For cancellation requests, prefer cancel_booking. " +
            "For booking requests, propose create_booking when realtor, exact date/time, street address, and services/catalog item ids are known. " +
            "Street address means street number + street name; city, province, and postal code are helpful but optional. Do not ask for postal code before creating a booking. " +
            "If the user gives a partial street address, use it as streetAddress. If it clearly matches one known address, use the highest-likelihood known address and mention that assumption in details. " +
            "For 'same as last time', use the most relevant previous booking as sourceBookingId and copy its catalogItemIds/services; still require a new street address unless the user explicitly says same property/address. " +
            "Return scheduledLocal as YYYY-MM-DDTHH:mm in America/Toronto. " +
            "Keep messages short and plain.",
        },
        {
          role: "user",
          content: JSON.stringify({
            request,
            currentLocalTime: context.nowLocal,
            availableActions: [
              "answer",
              "open_booking",
              "cancel_booking_requires_confirmation",
              "create_booking_requires_confirmation",
              "send_delivery_email_requires_confirmation",
              "update_booking_status_requires_confirmation",
              "draft_booking_needs_more_info",
            ],
            bookings: context.bookings,
            realtors: context.realtors,
            knownAddresses: context.knownAddresses,
            catalog: context.catalogLines,
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "admin_assistant_plan",
          strict: true,
          schema: PLAN_SCHEMA,
        },
      },
    }),
  });

  const json = (await res.json()) as unknown;
  if (!res.ok) {
    const message = openAiErrorMessage(json);
    throw new Error(message || `OpenAI request failed (${res.status}).`);
  }

  const text = extractOutputText(json);
  if (!text) throw new Error("OpenAI returned no assistant plan.");

  return JSON.parse(text) as ModelPlan;
}

async function getAssistantAIConfig(
  organizationId: string,
): Promise<{ apiKey: string | null; model: string }> {
  const [apiKey, model] = await Promise.all([
    getCredential("openai", "api_key", "OPENAI_API_KEY", organizationId),
    getCredential("openai", "model", "OPENAI_ASSISTANT_MODEL", organizationId),
  ]);
  return {
    apiKey,
    model: model || DEFAULT_MODEL,
  };
}

function normalizePlan(
  plan: ModelPlan,
  context: {
    bookingsById: Map<string, BookingContextRow>;
    lineItemIdsByBookingId: Map<string, string[]>;
    catalog: Catalog;
    catalogItemsById: Map<string, CatalogItemRow>;
    catalogItemsBySlug: Map<string, CatalogItemRow>;
  },
): AdminAssistantResult {
  const actions: AdminAssistantAction[] = [];
  const missing = plan.missing.filter(isRequiredMissingField);

  for (const raw of plan.actions) {
    if (raw.type === "none") continue;

    const booking =
      context.bookingsById.get(raw.bookingId) ||
      context.bookingsById.get(raw.draft.sourceBookingId);

    if (raw.type === "create_booking") {
      const built = buildCreateBookingAction(raw, context);
      if ("action" in built) {
        actions.push(built.action);
      } else {
        missing.push(...built.missing);
      }
      continue;
    }

    if (!booking) continue;

    if (raw.type === "cancel_booking" && !isCancellable(booking.status)) {
      return {
        ok: false,
        kind: "unsupported",
        message: `I found the booking, but it is ${booking.status}, so I won't cancel it from the assistant.`,
        actions: [
          {
            type: "open_booking",
            bookingId: booking.id,
            label: "Open booking",
            details: bookingLabel(booking),
            href: `/admin/bookings/${booking.id}`,
            destructive: false,
            requiresConfirmation: false,
          },
        ],
      };
    }

    if (raw.type === "update_booking_status") {
      const nextStatus = parseBookingStatus(raw.nextStatus);
      if (!nextStatus) {
        missing.push("next booking status");
        continue;
      }
      const allowed = nextBookingStatuses(booking.status);
      if (!allowed.includes(nextStatus)) {
        return {
          ok: false,
          kind: "unsupported",
          message: `I found the booking, but it can't move from ${booking.status} to ${nextStatus}.`,
          actions: [
            {
              type: "open_booking",
              bookingId: booking.id,
              label: "Open booking",
              details: bookingLabel(booking),
              href: `/admin/bookings/${booking.id}`,
              destructive: false,
              requiresConfirmation: false,
            },
          ],
        };
      }
      actions.push({
        type: "update_booking_status",
        bookingId: booking.id,
        label: raw.label || `Move to ${nextStatus}`,
        details: raw.details || bookingLabel(booking),
        href: `/admin/bookings/${booking.id}`,
        destructive: false,
        requiresConfirmation: true,
        nextStatus,
      });
      continue;
    }

    if (raw.type === "send_delivery_email") {
      actions.push({
        type: "send_delivery_email",
        bookingId: booking.id,
        label: raw.label || "Send delivery email",
        details: raw.details || bookingLabel(booking),
        href: `/admin/bookings/${booking.id}?tab=delivery`,
        destructive: false,
        requiresConfirmation: true,
      });
      continue;
    }

    actions.push({
      type: raw.type,
      bookingId: booking.id,
      label:
        raw.label ||
        (raw.type === "cancel_booking"
          ? "Cancel booking"
          : raw.type === "draft_booking"
            ? "Use as booking draft"
            : "Open booking"),
      details: raw.details || bookingLabel(booking),
      href: `/admin/bookings/${booking.id}`,
      destructive: raw.type === "cancel_booking",
      requiresConfirmation: raw.type === "cancel_booking",
    });
  }

  const missingText =
    missing.length > 0 ? `\n\nMissing: ${unique(missing).join(", ")}.` : "";

  return {
    ok: true,
    kind: actions.some((a) => a.requiresConfirmation)
      ? "needs_confirmation"
      : plan.kind,
    message: `${plan.message}${missingText}`,
    actions,
  };
}

function buildCreateBookingAction(
  raw: ModelPlan["actions"][number],
  context: {
    bookingsById: Map<string, BookingContextRow>;
    lineItemIdsByBookingId: Map<string, string[]>;
    catalog: Catalog;
    catalogItemsById: Map<string, CatalogItemRow>;
    catalogItemsBySlug: Map<string, CatalogItemRow>;
  },
):
  | { action: AdminAssistantAction }
  | { missing: string[] } {
  const draft = raw.draft;
  const sourceBooking =
    context.bookingsById.get(draft.sourceBookingId) ??
    context.bookingsById.get(raw.bookingId);
  const missing: string[] = [];

  const scheduledLocal = draft.scheduledLocal.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(scheduledLocal)) {
    missing.push("exact date and time");
  }

  const contactName = nonEmpty(draft.contactName, sourceBooking?.profiles?.full_name);
  const contactEmail = nonEmpty(draft.contactEmail, sourceBooking?.profiles?.email);
  if (!contactName) missing.push("realtor name");
  if (!contactEmail || !contactEmail.includes("@")) missing.push("realtor email");

  const sourceProperty = sourceBooking?.properties;
  const streetAddress = nonEmpty(
    draft.streetAddress,
    draft.useSourceProperty ? sourceProperty?.street_address : null,
  );
  if (!streetAddress) missing.push("property address");

  const catalogItemIds =
    draft.catalogItemIds.filter((id) => context.catalogItemsById.has(id)).length > 0
      ? draft.catalogItemIds.filter((id) => context.catalogItemsById.has(id))
      : sourceBooking
        ? catalogItemIdsForBooking(sourceBooking, context)
        : [];
  if (catalogItemIds.length === 0) missing.push("services/package");

  const cart = catalogItemIds.map((catalogItemId) => ({
    catalogItemId,
    quantity: 1,
  }));
  const cartError =
    catalogItemIds.length > 0 ? validateCart(cart, context.catalog) : null;
  if (cartError) missing.push(cartError);

  if (missing.length > 0) return { missing };

  const city = nonEmpty(
    draft.city,
    draft.useSourceProperty ? sourceProperty?.city : null,
  );
  const postalCode = nonEmpty(
    draft.postalCode,
    draft.useSourceProperty ? sourceProperty?.postal_code : null,
  );
  const squareFootage = nonEmpty(
    draft.squareFootage,
    sourceBooking?.square_footage ? String(sourceBooking.square_footage) : null,
  );
  const totals = computeCartTotals(
    cart,
    context.catalog,
    parseOptionalInt(squareFootage),
  );
  const itemNames = catalogItemIds
    .map((id) => context.catalogItemsById.get(id)?.name)
    .filter(Boolean)
    .join(", ");
  const payload: AdminAssistantBookingDraft = {
    sourceBookingId: sourceBooking?.id ?? "",
    scheduledLocal,
    contactName,
    contactEmail,
    contactPhone: nonEmpty(draft.contactPhone, sourceBooking?.profiles?.phone),
    brokerage: nonEmpty(draft.brokerage, sourceBooking?.profiles?.brokerage),
    streetAddress,
    unitNumber: draft.useSourceProperty
      ? nonEmpty(draft.unitNumber, sourceBooking?.unit_number)
      : draft.unitNumber.trim(),
    city,
    province: nonEmpty(draft.province, "ON"),
    postalCode,
    squareFootage,
    notes: draft.notes.trim(),
    catalogItemIds,
  };

  return {
    action: {
      type: "create_booking",
      bookingId: sourceBooking?.id ?? "",
      label: "Create booking",
      details: [
        `${contactName} · ${scheduledLocal.replace("T", " ")}`,
        streetAddress,
        itemNames,
        `${Math.max(totals.totalDurationMinutes, 60)} min · $${(
          totals.totalPriceCents / 100
        ).toFixed(2)}`,
      ]
        .filter(Boolean)
        .join(" · "),
      href: "/admin/calendar",
      destructive: false,
      requiresConfirmation: true,
      draft: payload,
    },
  };
}

async function createBookingFromAssistant(
  action: AdminAssistantAction,
): Promise<AdminAssistantResult> {
  const draft = action.draft;
  if (!draft) {
    return {
      ok: false,
      kind: "needs_clarification",
      message: "The booking draft was missing. Ask me to prepare it again.",
      actions: [],
    };
  }

  const formData = new FormData();
  formData.set("scheduled_at", draft.scheduledLocal);
  formData.set("contact_name", draft.contactName);
  formData.set("contact_email", draft.contactEmail);
  formData.set("contact_phone", draft.contactPhone);
  formData.set("brokerage", draft.brokerage);
  formData.set("street_address", draft.streetAddress);
  formData.set("unit_number", draft.unitNumber);
  formData.set("city", draft.city);
  formData.set("province", draft.province || "ON");
  formData.set("postal_code", draft.postalCode);
  formData.set("square_footage", draft.squareFootage);
  formData.set("notes", draft.notes);
  for (const catalogItemId of draft.catalogItemIds) {
    formData.append("catalog_item_id", catalogItemId);
  }

  const result = await createAdminShoot(formData);
  if (!result.ok || !result.bookingId) {
    return {
      ok: false,
      kind: "needs_clarification",
      message: result.error ?? "I couldn't create that booking.",
      actions: [],
    };
  }

  return {
    ok: true,
    kind: "answer",
    message:
      "Done. I created the booking, checked the slot, added it to Google Calendar if connected, and sent the confirmation email.",
    actions: [
      {
        type: "open_booking",
        bookingId: result.bookingId,
        label: "Open new booking",
        details: action.details,
        href: `/admin/bookings/${result.bookingId}`,
        destructive: false,
        requiresConfirmation: false,
      },
    ],
  };
}

function catalogItemIdsForBooking(
  booking: BookingContextRow,
  context: {
    lineItemIdsByBookingId: Map<string, string[]>;
    catalogItemsBySlug: Map<string, CatalogItemRow>;
  },
): string[] {
  const fromLineItems = context.lineItemIdsByBookingId.get(booking.id) ?? [];
  if (fromLineItems.length > 0) return fromLineItems;

  return [...booking.services, ...booking.add_ons]
    .map((slug) => context.catalogItemsBySlug.get(slug)?.id)
    .filter((id): id is string => Boolean(id));
}

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "message", "actions", "missing"],
  properties: {
    kind: {
      type: "string",
      enum: ["answer", "needs_confirmation", "needs_clarification", "unsupported"],
    },
    message: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "bookingId", "label", "details", "nextStatus", "draft"],
        properties: {
          type: {
            type: "string",
            enum: [
              "cancel_booking",
              "create_booking",
              "open_booking",
              "draft_booking",
              "update_booking_status",
              "send_delivery_email",
              "none",
            ],
          },
          bookingId: { type: "string" },
          label: { type: "string" },
          details: { type: "string" },
          nextStatus: {
            type: "string",
            enum: [
              "",
              "requested",
              "confirmed",
              "shot",
              "editing",
              "delivered",
              "cancelled",
            ],
          },
          draft: {
            type: "object",
            additionalProperties: false,
            required: [
              "sourceBookingId",
              "scheduledLocal",
              "contactName",
              "contactEmail",
              "contactPhone",
              "brokerage",
              "streetAddress",
              "unitNumber",
              "city",
              "province",
              "postalCode",
              "squareFootage",
              "notes",
              "catalogItemIds",
              "useSourceProperty",
            ],
            properties: {
              sourceBookingId: { type: "string" },
              scheduledLocal: { type: "string" },
              contactName: { type: "string" },
              contactEmail: { type: "string" },
              contactPhone: { type: "string" },
              brokerage: { type: "string" },
              streetAddress: { type: "string" },
              unitNumber: { type: "string" },
              city: { type: "string" },
              province: { type: "string" },
              postalCode: { type: "string" },
              squareFootage: { type: "string" },
              notes: { type: "string" },
              catalogItemIds: {
                type: "array",
                items: { type: "string" },
              },
              useSourceProperty: { type: "boolean" },
            },
          },
        },
      },
    },
    missing: {
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

function bookingLabel(booking: BookingContextRow): string {
  const address = [
    booking.properties?.street_address,
    booking.properties?.city,
    booking.properties?.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
  return `${address || "Unknown address"} · ${
    booking.scheduled_at ? formatLocal(booking.scheduled_at) : "not scheduled"
  }`;
}

function nonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function parseOptionalInt(value: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
}

function parseBookingStatus(value: string): BookingStatus | null {
  if (
    value === "requested" ||
    value === "confirmed" ||
    value === "shot" ||
    value === "editing" ||
    value === "delivered" ||
    value === "cancelled"
  ) {
    return value;
  }
  return null;
}

function isRequiredMissingField(value: string): boolean {
  const normalized = value.toLowerCase();
  return ![
    "city",
    "province",
    "postal",
    "postal code",
    "zip",
    "zip code",
    "full address",
    "full property address",
  ].some((optional) => normalized.includes(optional));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function formatLocal(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
