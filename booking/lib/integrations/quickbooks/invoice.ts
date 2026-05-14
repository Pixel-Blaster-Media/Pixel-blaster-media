import "server-only";

import { labelForAddOn, labelForService } from "@/lib/booking/services";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

import { getQBClient, QBOError } from "./client";

type ServicePriceRow = Database["public"]["Tables"]["service_prices"]["Row"];
type ConnectionRow =
  Database["public"]["Tables"]["quickbooks_connection"]["Row"];

interface BookingLineItemForInvoice {
  quantity: number;
  unit_price_cents: number;
  catalog_items: {
    name: string;
  } | null;
}

/**
 * Build + submit a QuickBooks Online invoice for one of our bookings.
 *
 * Steps:
 *   1. Look up the connection (for the default item id) and prices.
 *   2. Find or create a QB Customer for the realtor's email.
 *   3. Build the Invoice body: one line per selected service / add-on.
 *   4. POST to /invoice. Store the returned invoice id + number + URL
 *      on the booking so we can surface it in admin.
 *
 * Idempotency: if the booking already has a `quickbooks_invoice_id`,
 * we skip (re-syncing an existing invoice's status is a separate call).
 */

export interface CreateInvoiceInput {
  bookingId: string;
  services: string[];
  addOns: string[];
  realtor: {
    email: string;
    full_name: string | null;
    phone: string | null;
    brokerage: string | null;
  };
  property: {
    street_address: string;
    city: string | null;
    postal_code: string | null;
  };
}

export interface CreateInvoiceResult {
  ok: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  invoiceUrl?: string;
  totalCents?: number;
  error?: string;
}

interface QBOCustomer {
  Id: string;
  DisplayName: string;
  PrimaryEmailAddr?: { Address?: string };
}

interface QBOInvoice {
  Id: string;
  DocNumber?: string;
  TotalAmt?: number;
  Balance?: number;
}

interface QueryResponse<T> {
  QueryResponse: {
    Customer?: T[];
    Invoice?: T[];
    Item?: T[];
    maxResults?: number;
  };
}

export async function createInvoiceForBooking(
  input: CreateInvoiceInput,
): Promise<CreateInvoiceResult> {
  const supabase = getServiceSupabase();

  // Short-circuit if an invoice already exists for this booking.
  const { data: existing } = await supabase
    .from("bookings")
    .select(
      "organization_id, quickbooks_invoice_id, quickbooks_invoice_url, quickbooks_invoice_status",
    )
    .eq("id", input.bookingId)
    .maybeSingle<{
      organization_id: string;
      quickbooks_invoice_id: string | null;
      quickbooks_invoice_url: string | null;
      quickbooks_invoice_status: string | null;
    }>();

  if (existing?.quickbooks_invoice_id) {
    return {
      ok: true,
      invoiceId: existing.quickbooks_invoice_id,
      invoiceUrl: existing.quickbooks_invoice_url ?? undefined,
    };
  }
  if (existing?.quickbooks_invoice_status === "creating") {
    return {
      ok: false,
      error:
        "An invoice is already being created for this booking. Wait a moment, then refresh the invoice status.",
    };
  }

  // Connection + default item
  const { data: conn } = await supabase
    .from("quickbooks_connection")
    .select("*")
    .eq("organization_id", existing?.organization_id ?? "")
    .maybeSingle<ConnectionRow>();

  if (!conn) {
    return { ok: false, error: "QuickBooks is not connected." };
  }
  if (!conn.default_item_id) {
    return {
      ok: false,
      error:
        "Pick a default QuickBooks service item in /admin/settings/integrations before creating invoices.",
    };
  }

  const lineItems: { description: string; amountCents: number }[] = [];

  const { data: snapshotLines, error: snapshotErr } = await supabase
    .from("booking_line_items")
    .select("quantity, unit_price_cents, catalog_items(name)")
    .eq("booking_id", input.bookingId)
    .returns<BookingLineItemForInvoice[]>();
  if (snapshotErr) return { ok: false, error: snapshotErr.message };

  if (snapshotLines && snapshotLines.length > 0) {
    for (const line of snapshotLines) {
      if (line.unit_price_cents > 0) {
        lineItems.push({
          description: line.catalog_items?.name ?? "Booking item",
          amountCents: line.unit_price_cents * Math.max(1, line.quantity),
        });
      }
    }
  } else {
    // Fallback for old bookings that predate booking_line_items.
    const { data: priceRows, error: priceErr } = await supabase
      .from("service_prices")
      .select("service_id, price_cents, taxable")
      .eq("organization_id", existing?.organization_id ?? "")
      .returns<ServicePriceRow[]>();
    if (priceErr) return { ok: false, error: priceErr.message };

    const priceByService = new Map(
      (priceRows ?? []).map((r) => [r.service_id, r.price_cents]),
    );

    for (const sid of input.services) {
      const cents = priceByService.get(sid) ?? 0;
      if (cents === 0) {
        return {
          ok: false,
          error: `Price for "${labelForService(sid)}" is $0 — set a real price in /admin/settings/pricing first.`,
        };
      }
      lineItems.push({ description: labelForService(sid), amountCents: cents });
    }
    for (const aid of input.addOns) {
      const cents = priceByService.get(aid) ?? 0;
      if (cents > 0) {
        lineItems.push({ description: labelForAddOn(aid), amountCents: cents });
      }
    }
  }

  if (lineItems.length === 0) {
    return {
      ok: false,
      error: "No services on this booking — nothing to invoice.",
    };
  }

  let qb;
  try {
    qb = await getQBClient({
      organizationId: existing?.organization_id,
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof QBOError ? err.message : "QuickBooks client unavailable.",
    };
  }

  const { data: locked, error: lockErr } = await supabase
    .from("bookings")
    .update({ quickbooks_invoice_status: "creating" })
    .eq("id", input.bookingId)
    .eq("organization_id", existing?.organization_id ?? "")
    .is("quickbooks_invoice_id", null)
    .or(
      "quickbooks_invoice_status.is.null,quickbooks_invoice_status.neq.creating",
    )
    .select("id")
    .maybeSingle<{ id: string }>();

  if (lockErr) return { ok: false, error: lockErr.message };
  if (!locked) {
    return {
      ok: false,
      error:
        "An invoice is already being created for this booking. Wait a moment, then refresh the invoice status.",
    };
  }

  // Find or create customer.
  let customerId: string | null;
  try {
    customerId = await findOrCreateCustomer(qb, input.realtor);
  } catch (err) {
    await clearInvoiceCreationLock(input.bookingId);
    return {
      ok: false,
      error: err instanceof QBOError ? err.message : String(err),
    };
  }
  if (!customerId) {
    await clearInvoiceCreationLock(input.bookingId);
    return { ok: false, error: "Could not find or create QuickBooks customer." };
  }

  // Build invoice body.
  const propertyLine = [
    input.property.street_address,
    [input.property.city, input.property.postal_code].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  const invoiceBody = {
    CustomerRef: { value: customerId },
    CustomerMemo: {
      value: `Shoot at ${propertyLine}`,
    },
    Line: lineItems.map((l) => ({
      DetailType: "SalesItemLineDetail",
      Amount: l.amountCents / 100,
      Description: `${l.description} — ${propertyLine}`,
      SalesItemLineDetail: {
        ItemRef: { value: conn.default_item_id! },
        Qty: 1,
        UnitPrice: l.amountCents / 100,
      },
    })),
  };

  let created;
  try {
    created = await qb.request<{ Invoice: QBOInvoice }>(
      "/invoice",
      { method: "POST", body: invoiceBody },
    );
  } catch (err) {
    const msg = err instanceof QBOError ? `${err.message}: ${err.body.slice(0, 200)}` : String(err);
    console.error("[qbo.invoice] create failed", msg);
    await clearInvoiceCreationLock(input.bookingId);
    return { ok: false, error: `QuickBooks rejected the invoice: ${msg}` };
  }

  const inv = created.Invoice;
  const totalCents = Math.round((inv.TotalAmt ?? 0) * 100);
  const invoiceUrl = buildInvoiceUrl(qb.environment, qb.realmId, inv.Id);

  // Persist back to the booking.
  const { error: updErr } = await supabase
    .from("bookings")
    .update({
      quickbooks_invoice_id: inv.Id,
      quickbooks_invoice_number: inv.DocNumber ?? null,
      quickbooks_invoice_url: invoiceUrl,
      quickbooks_invoice_status: (inv.Balance ?? 0) > 0 ? "open" : "paid",
      quickbooks_invoice_total_cents: totalCents,
      quickbooks_invoice_synced_at: new Date().toISOString(),
    })
    .eq("id", input.bookingId);

  if (updErr) {
    console.warn("[qbo.invoice] booking update failed", updErr);
  }

  return {
    ok: true,
    invoiceId: inv.Id,
    invoiceNumber: inv.DocNumber ?? undefined,
    invoiceUrl,
    totalCents,
  };
}

async function clearInvoiceCreationLock(bookingId: string): Promise<void> {
  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("bookings")
    .update({ quickbooks_invoice_status: null })
    .eq("id", bookingId)
    .eq("quickbooks_invoice_status", "creating")
    .is("quickbooks_invoice_id", null);
  if (error) console.warn("[qbo.invoice] lock clear failed", error);
}

/**
 * Re-fetch an invoice from QB and update our status/total.
 * Used by the "Refresh status" button on the booking detail page.
 */
export async function refreshInvoiceStatus(
  bookingId: string,
): Promise<{ ok: boolean; error?: string; status?: string }> {
  const supabase = getServiceSupabase();
  const { data: booking } = await supabase
    .from("bookings")
    .select("organization_id, quickbooks_invoice_id")
    .eq("id", bookingId)
    .maybeSingle<{
      organization_id: string;
      quickbooks_invoice_id: string | null;
    }>();

  if (!booking?.quickbooks_invoice_id) {
    return { ok: false, error: "No invoice to refresh." };
  }

  let qb;
  try {
    qb = await getQBClient({ organizationId: booking.organization_id });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof QBOError ? err.message : "QuickBooks unavailable.",
    };
  }

  let fetched;
  try {
    fetched = await qb.request<{ Invoice: QBOInvoice }>(
      `/invoice/${booking.quickbooks_invoice_id}`,
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof QBOError ? err.message : String(err),
    };
  }

  const inv = fetched.Invoice;
  const status = (inv.Balance ?? 0) > 0 ? "open" : "paid";
  const totalCents = Math.round((inv.TotalAmt ?? 0) * 100);

  await supabase
    .from("bookings")
    .update({
      quickbooks_invoice_status: status,
      quickbooks_invoice_total_cents: totalCents,
      quickbooks_invoice_synced_at: new Date().toISOString(),
    })
    .eq("id", bookingId);

  return { ok: true, status };
}

// ---- Internal helpers ----

async function findOrCreateCustomer(
  qb: Awaited<ReturnType<typeof getQBClient>>,
  realtor: CreateInvoiceInput["realtor"],
): Promise<string | null> {
  const email = realtor.email.replace(/'/g, "\\'");

  try {
    const existing = await qb.query<QueryResponse<QBOCustomer>>(
      `SELECT Id, DisplayName, PrimaryEmailAddr FROM Customer WHERE PrimaryEmailAddr = '${email}' MAXRESULTS 1`,
    );
    const hit = existing.QueryResponse.Customer?.[0];
    if (hit?.Id) return hit.Id;
  } catch (err) {
    console.warn("[qbo.invoice] customer lookup failed, will try create", err);
  }

  const displayName = [realtor.full_name, realtor.brokerage]
    .filter(Boolean)
    .join(" · ") || realtor.email;

  const body: Record<string, unknown> = {
    DisplayName: displayName,
    PrimaryEmailAddr: { Address: realtor.email },
  };
  if (realtor.full_name) {
    const [given, ...rest] = realtor.full_name.split(" ");
    body.GivenName = given;
    if (rest.length > 0) body.FamilyName = rest.join(" ");
  }
  if (realtor.brokerage) body.CompanyName = realtor.brokerage;
  if (realtor.phone) body.PrimaryPhone = { FreeFormNumber: realtor.phone };

  const created = await qb.request<{ Customer: QBOCustomer }>(
    "/customer",
    { method: "POST", body },
  );
  return created.Customer?.Id ?? null;
}

/** Deep-link to the invoice inside QB's UI so the admin can open it. */
function buildInvoiceUrl(
  env: "sandbox" | "production",
  realmId: string,
  invoiceId: string,
): string {
  const host = env === "production" ? "app.qbo.intuit.com" : "app.sandbox.qbo.intuit.com";
  return `https://${host}/app/invoice?txnId=${invoiceId}&realmId=${realmId}`;
}
