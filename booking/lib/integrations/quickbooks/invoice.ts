import "server-only";

import { labelForAddOn, labelForService } from "@/lib/booking/services";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

import { getQBClient, QBOError } from "./client";
import { persistInvoiceReceipt } from './receipt';
import { verifyAdoption } from './adoption';
import type { Json } from '@/lib/supabase/database.types';

// Additive migration RPCs: explicit local boundary until generated types refresh.
function invoiceRPC(name: string, args: Record<string, unknown>) {
  const rpc = getServiceSupabase().rpc.bind(getServiceSupabase()) as unknown as
    (name: string, args: Record<string, unknown>) => PromiseLike<{data: Json; error: unknown}>;
  return rpc(name,args);
}

type ServicePriceRow = Database["public"]["Tables"]["service_prices"]["Row"];
type ConnectionRow =
  Database["public"]["Tables"]["quickbooks_connection"]["Row"];

interface BookingLineItemForInvoice {
  quantity: number;
  unit_price_cents: number;
  item_name: string;
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
  /** Exact immutable invoice lines from the claimed durable job. */
  lineItems?: Array<{ description: string; amountCents: number }>;
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

export async function requestInvoiceForBooking(organizationId:string,bookingId:string):Promise<boolean> {
  try {
    const result=await invoiceRPC('request_quickbooks_invoice',{p_organization_id:organizationId,p_booking_id:bookingId});
    return !result.error && result.data===true;
  } catch {return false;}
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
  if (!existing) return {ok:false,error:'Booking unavailable.'};
  if(!await requestInvoiceForBooking(existing.organization_id,input.bookingId)) return {ok:false,error:'Invoice intent could not be saved.'};
  if (existing.quickbooks_invoice_status === 'creating' || existing.quickbooks_invoice_status === 'reconciliation_required') {
    return {ok:false,error:'Invoice requires reconciliation. Do not create another invoice.'};
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

  const lineItems: { description: string; amountCents: number }[] =
    input.lineItems?.map((line) => ({ ...line })) ?? [];

  if (!input.lineItems) {
    const { data: snapshotLines, error: snapshotErr } = await supabase
      .from("booking_line_items")
      .select("quantity, unit_price_cents, item_name")
      .eq("booking_id", input.bookingId)
      .returns<BookingLineItemForInvoice[]>();
    if (snapshotErr) return { ok: false, error: snapshotErr.message };

    if (snapshotLines && snapshotLines.length > 0) {
      for (const line of snapshotLines) {
        if (line.unit_price_cents > 0) {
          lineItems.push({
            description: line.item_name,
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
  }

  if(lineItems.some(l=>typeof l.description!=='string' || !l.description.trim() || l.description.length>1000 || !Number.isSafeInteger(l.amountCents) || l.amountCents<=0 || l.amountCents>2147483647)) return {ok:false,error:'Invalid invoice line snapshot.'};
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

  const { data: claimData, error: lockErr } = await invoiceRPC('begin_quickbooks_invoice', {
    p_organization_id:existing.organization_id,p_booking_id:input.bookingId,
    p_realm_id:qb.realmId,p_environment:qb.environment,
    p_snapshot:{realtor:input.realtor,property:input.property,lineItems,defaultItemId:conn.default_item_id},
  });
  const claim=claimData as {id?:string;state?:string;lease_token?:string}|null;
  if(lockErr || !claim?.id || claim.state!=='processing' || !claim.lease_token) return {ok:false,error:'Invoice intent is unresolved or could not be saved. Reconciliation required.'};
  const settleFailure=async(state:'rejected'|'unknown')=> {
    const result=await invoiceRPC('finish_quickbooks_invoice',{p_organization_id:existing.organization_id,p_intent_id:claim.id,p_lease_token:claim.lease_token,p_state:state});
    return !result.error && result.data===true;
  };

  // Find or create customer.
  let customerId: string | null;
  try {
    customerId = await findOrCreateCustomer(qb, input.realtor);
  } catch (err) {
    await settleFailure('unknown');
    return {
      ok: false,
      error: err instanceof QBOError ? err.message : String(err),
    };
  }
  if (!customerId) {
    await settleFailure('unknown');
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
    PrivateNote: `pixel-invoice-intent:${claim.id}`,
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

  const staged=await invoiceRPC('stage_quickbooks_invoice',{p_organization_id:existing.organization_id,p_intent_id:claim.id,p_lease_token:claim.lease_token,p_body:invoiceBody});
  if(staged.error || staged.data!==true) return {ok:false,error:'Invoice request could not be durably staged. Reconciliation required.'};
  let created;
  try {
    created = await qb.request<{ Invoice: QBOInvoice }>(
      "/invoice",
      { method: "POST", body: invoiceBody, query:{requestid:claim.id} },
    );
  } catch (err) {
    const msg = err instanceof QBOError
      ? `QuickBooks rejected the invoice (status ${err.status})`
      : "QuickBooks invoice request failed";
    console.error("[qbo.invoice] create failed", {
      status: err instanceof QBOError ? err.status : null,
    });
    const persisted=await settleFailure(err instanceof QBOError ? err.outcome : 'unknown');
    return { ok: false, error: persisted ? msg + '. Reconciliation required.' : 'Invoice outcome could not be saved; reconciliation required.' };
  }

  const result=await persistInvoiceReceipt(created?.Invoice,async(receipt)=>{
    const saved=await invoiceRPC('finish_quickbooks_invoice',{
      p_organization_id:existing.organization_id,p_intent_id:claim.id,p_lease_token:claim.lease_token,p_state:'confirmed',
      p_invoice_id:receipt.invoiceId,p_number:receipt.invoiceNumber,p_total:receipt.totalCents,p_balance:receipt.balanceCents,
    });
    return !saved.error && saved.data===true;
  });
  if(!result.ok) return result;
  return {ok:true,invoiceId:result.invoiceId,invoiceNumber:result.invoiceNumber??undefined,totalCents:result.totalCents,invoiceUrl:buildInvoiceUrl(qb.environment,qb.realmId,result.invoiceId)};
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

  const result=await persistInvoiceReceipt(fetched?.Invoice,async receipt=>{
    if(receipt.invoiceId!==booking.quickbooks_invoice_id) return false;
    const {data,error}=await supabase.from('bookings').update({quickbooks_invoice_status:receipt.status,quickbooks_invoice_total_cents:receipt.totalCents,quickbooks_invoice_synced_at:new Date().toISOString()}).eq('id',bookingId).eq('organization_id',booking.organization_id).eq('quickbooks_invoice_id',receipt.invoiceId).select('id').maybeSingle();
    return !error && Boolean(data);
  });
  return result.ok ? {ok:true,status:result.status} : {ok:false,error:result.error};
}

import type { SupabaseClient } from '@supabase/supabase-js';

/** GET-only provider verification followed by atomic tenant/admin-fenced adoption. */
export async function adoptInvoiceForBooking(organizationId:string,bookingId:string,actorId:string,invoiceId:string,note:string):Promise<CreateInvoiceResult> {
 if(!/^[0-9]{1,64}$/.test(invoiceId) || note.trim().length<10 || note.length>500) return {ok:false,error:'Invoice ID and a 10–500 character investigation note are required.'};
 try {
  const service=getServiceSupabase() as SupabaseClient;
  const {data:intent,error}=await service.from('quickbooks_invoice_intents').select('realm_id,environment,invoice_body').eq('organization_id',organizationId).eq('booking_id',bookingId).maybeSingle();
  if(error || !intent?.invoice_body) return {ok:false,error:'No verifiable invoice request. Legacy attempts require manual investigation; adoption is blocked.'};
  const qb=await getQBClient({organizationId});
  if(qb.realmId!==intent.realm_id || qb.environment!==intent.environment) return {ok:false,error:'QuickBooks connection does not match the invoice intent.'};
  const fetched=await qb.request<{Invoice:unknown}>(`/invoice/${invoiceId}`);
  const receipt=verifyAdoption(fetched?.Invoice,intent.invoice_body,invoiceId);
  const saved=await invoiceRPC('adopt_quickbooks_invoice',{p_organization_id:organizationId,p_booking_id:bookingId,p_actor:actorId,p_note:note,p_realm_id:qb.realmId,p_environment:qb.environment,p_body:intent.invoice_body,p_invoice_id:invoiceId,p_number:receipt.invoiceNumber,p_total:receipt.totalCents,p_balance:receipt.balanceCents});
  if(saved.error || saved.data!==true) return {ok:false,error:'Adoption was not confirmed. Refresh and investigate; do not recreate.'};
  return {ok:true,invoiceId,invoiceUrl:buildInvoiceUrl(qb.environment,qb.realmId,invoiceId)};
 } catch {return {ok:false,error:'Invoice verification or adoption failed. No new invoice was created.'};}
}

// ---- Internal helpers ----

async function findOrCreateCustomer(
  qb: Awaited<ReturnType<typeof getQBClient>>,
  realtor: CreateInvoiceInput["realtor"],
): Promise<string | null> {
  const email = escapeQBQLString(realtor.email);

  if (isValidEmailForQBQL(realtor.email)) {
    try {
      const existing = await qb.query<QueryResponse<QBOCustomer>>(
        `SELECT Id, DisplayName, PrimaryEmailAddr FROM Customer WHERE PrimaryEmailAddr = '${email}' MAXRESULTS 1`,
      );
      const hit = existing.QueryResponse.Customer?.[0];
      if (hit?.Id) return hit.Id;
    } catch {
      throw new Error('QuickBooks customer lookup unavailable; no create authorized.');
    }
  } else {
    throw new Error('Invalid customer email; no create authorized.');
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

function isValidEmailForQBQL(value: string): boolean {
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(
    value,
  );
}

function escapeQBQLString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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
