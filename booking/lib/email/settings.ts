import "server-only";

import { DEFAULT_ORGANIZATION_NAME } from "@/lib/organizations/default";
import { getServiceSupabase } from "@/lib/supabase/server";

interface OrganizationEmailRow {
  name: string;
  email_from_name: string | null;
  reply_to_email: string | null;
  admin_notification_email: string | null;
  invoice_timing: string | null;
}

type InvoiceTiming = "on_delivery" | "at_booking";

export interface OrganizationEmailSettings {
  organizationName: string;
  fromName: string;
  replyToEmail: string | null;
  adminNotificationEmail: string | null;
  /** When the QuickBooks payment link is emailed automatically. */
  invoiceTiming: InvoiceTiming;
}

export async function getOrganizationEmailSettings(
  organizationId?: string | null,
): Promise<OrganizationEmailSettings> {
  if (!organizationId) return fallbackSettings();

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("organizations")
    .select(
      "name, email_from_name, reply_to_email, admin_notification_email, invoice_timing",
    )
    .eq("id", organizationId)
    .maybeSingle<OrganizationEmailRow>();

  if (error) {
    console.warn("[email] organization email settings lookup failed", error);
    return fallbackSettings();
  }

  const organizationName = clean(data?.name) || DEFAULT_ORGANIZATION_NAME;
  return {
    organizationName,
    fromName: clean(data?.email_from_name) || organizationName,
    replyToEmail:
      clean(data?.reply_to_email) ||
      clean(data?.admin_notification_email) ||
      clean(process.env.ADMIN_NOTIFICATION_EMAIL),
    adminNotificationEmail:
      clean(data?.admin_notification_email) ||
      clean(process.env.ADMIN_NOTIFICATION_EMAIL),
    invoiceTiming: normalizeInvoiceTiming(data?.invoice_timing),
  };
}

export async function getAdminNotificationEmail(
  organizationId?: string | null,
): Promise<string | null> {
  const settings = await getOrganizationEmailSettings(organizationId);
  return settings.adminNotificationEmail;
}

export function formatFromAddress(
  baseFrom: string,
  displayName?: string | null,
): string {
  const trimmed = baseFrom.trim();
  const name = clean(displayName);
  if (!name) return trimmed;

  const parsed = trimmed.match(/<([^>]+)>/);
  const address = parsed?.[1]?.trim() || trimmed;
  if (!isEmailLike(address)) return trimmed;

  return `"${name.replace(/"/g, "'")}" <${address}>`;
}

function fallbackSettings(): OrganizationEmailSettings {
  const fallbackName = DEFAULT_ORGANIZATION_NAME;
  return {
    organizationName: fallbackName,
    fromName: fallbackName,
    replyToEmail: clean(process.env.ADMIN_NOTIFICATION_EMAIL),
    adminNotificationEmail: clean(process.env.ADMIN_NOTIFICATION_EMAIL),
    invoiceTiming: "on_delivery",
  };
}

function normalizeInvoiceTiming(value?: string | null): InvoiceTiming {
  return value === "at_booking" ? "at_booking" : "on_delivery";
}

function clean(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
