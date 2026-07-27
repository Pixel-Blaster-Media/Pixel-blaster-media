export interface BookingIntegrationPayload {
  schema_version: 1;
  booking_id: string;
  organization_id: string;
  public_request_id: string;
  app_url: string;
  organization: {
    name: string;
    from_name: string;
    reply_to_email: string | null;
    admin_notification_email: string | null;
  };
  realtor: {
    id: string;
    email: string;
    full_name: string;
    phone: string | null;
    brokerage: string | null;
    delivery_cc_emails: string[];
  };
  property: {
    street_address: string;
    city: string | null;
    postal_code: string | null;
    unit_number: string | null;
  };
  booking: {
    scheduled_at: string;
    scheduled_ends_at: string;
    square_footage: number | null;
    is_vacant: "vacant" | "occupied" | "partial" | null;
    include_basement: boolean | null;
    client_notes: string;
  };
  line_items: Array<{
    catalog_item_id: string;
    name: string;
    slug: string;
    kind: "bundle" | "a_la_carte" | "addon";
    quantity: number;
    unit_price_cents: number;
    unit_duration_minutes: number;
  }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_DEFAULT_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RFC3339_RE = /^([1-9]\d{3})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/;
const APP_PATH_RE = String.raw`(?:[/?#][^\s<>"']*)?`;
const HTTPS_APP_URL_RE = new RegExp(
  String.raw`^https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?${APP_PATH_RE}$`,
  "i",
);
const PORT_RE = String.raw`(?:0|[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])`;
const LOCAL_APP_URL_RE = new RegExp(
  String.raw`^http://(?:localhost|127\.0\.0\.1)(?::${PORT_RE})?${APP_PATH_RE}$`,
  "i",
);

export function parseBookingIntegrationPayload(
  value: unknown,
): BookingIntegrationPayload | null {
  if (!isRecord(value) || value.schema_version !== 1) return null;
  if (
    !uuid(value.booking_id) ||
    !organizationId(value.organization_id) ||
    !uuid(value.public_request_id) ||
    typeof value.app_url !== "string" ||
    !safeAppUrl(value.app_url) ||
    !isRecord(value.organization) ||
    !isRecord(value.realtor) ||
    !isRecord(value.property) ||
    !isRecord(value.booking) ||
    !Array.isArray(value.line_items) ||
    value.line_items.length === 0
  ) return null;

  const organization = value.organization;
  const realtor = value.realtor;
  const property = value.property;
  const booking = value.booking;
  const startMs = timestamp(booking.scheduled_at);
  const endMs = timestamp(booking.scheduled_ends_at);

  if (
    !nonEmpty(organization.name) ||
    !nonEmpty(organization.from_name) ||
    !nullableEmail(organization.reply_to_email) ||
    !nullableEmail(organization.admin_notification_email) ||
    !uuid(realtor.id) ||
    !email(realtor.email) ||
    !nonEmpty(realtor.full_name) ||
    !nullableString(realtor.phone) ||
    !nullableString(realtor.brokerage) ||
    !Array.isArray(realtor.delivery_cc_emails) ||
    !realtor.delivery_cc_emails.every(email) ||
    !nonEmpty(property.street_address) ||
    !nullableString(property.city) ||
    !nullableString(property.postal_code) ||
    !nullableString(property.unit_number) ||
    startMs === null ||
    endMs === null ||
    endMs <= startMs ||
    !nullableNonNegativeInteger(booking.square_footage) ||
    ![null, "vacant", "occupied", "partial"].includes(booking.is_vacant as never) ||
    !nullableBoolean(booking.include_basement) ||
    typeof booking.client_notes !== "string"
  ) return null;

  for (const item of value.line_items) {
    if (
      !isRecord(item) ||
      !uuid(item.catalog_item_id) ||
      !nonEmpty(item.name) ||
      !nonEmpty(item.slug) ||
      !["bundle", "a_la_carte", "addon"].includes(String(item.kind)) ||
      !positiveInteger(item.quantity) ||
      !nonNegativeInteger(item.unit_price_cents) ||
      !nonNegativeInteger(item.unit_duration_minutes)
    ) return null;
  }

  return value as unknown as BookingIntegrationPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function organizationId(value: unknown): value is string {
  return value === LEGACY_DEFAULT_ORGANIZATION_ID || uuid(value);
}

function email(value: unknown): value is string {
  return typeof value === "string" && EMAIL_RE.test(value);
}

function nullableEmail(value: unknown): boolean {
  return value === null || email(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nullableNonNegativeInteger(value: unknown): boolean {
  return value === null || nonNegativeInteger(value);
}

function nullableBoolean(value: unknown): boolean {
  return value === null || typeof value === "boolean";
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = RFC3339_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeAppUrl(value: string): boolean {
  if (value === "") return true;
  if (!HTTPS_APP_URL_RE.test(value) && !LOCAL_APP_URL_RE.test(value)) return false;
  try {
    const parsed = new URL(value);
    return !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
