export type BookingSearchCursor = { id: string; priority: number; scheduled_at: string | null; created_at: string };
export type RealtorSearchCursor = { id: string; full_name: string | null; email: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= days;
}

/** Invalid/legacy links restart at page one. Preserve SQL microseconds verbatim. */
export function parseAdminSearchCursor(value: string | undefined, kind: "booking"): BookingSearchCursor | null;
export function parseAdminSearchCursor(value: string | undefined, kind: "realtor"): RealtorSearchCursor | null;
export function parseAdminSearchCursor(value: string | undefined, kind: "booking" | "realtor"): BookingSearchCursor | RealtorSearchCursor | null {
  if (!value || value.length > 8192) return null;
  try {
    const row = JSON.parse(value);
    if (!row || Array.isArray(row) || typeof row.id !== "string" || !uuid.test(row.id)) return null;
    if (kind === "booking") {
      if ((row.priority !== 0 && row.priority !== 1) || !timestamp(row.created_at) || !(row.scheduled_at === null || timestamp(row.scheduled_at))) return null;
      return { id: row.id, priority: row.priority, scheduled_at: row.scheduled_at, created_at: row.created_at };
    }
    if (!(row.full_name === null || typeof row.full_name === "string") || typeof row.email !== "string") return null;
    return { id: row.id, full_name: row.full_name, email: row.email };
  } catch { return null; }
}
