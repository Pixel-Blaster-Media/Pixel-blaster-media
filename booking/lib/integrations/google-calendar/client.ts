import "server-only";

import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

import {
  refreshAccessToken,
  type TokenResponse,
} from "./oauth";

type ConnectionRow =
  Database["public"]["Tables"]["google_calendar_connection"]["Row"];

/** 5-minute safety margin before the stored expiry — avoids mid-call token death. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "GoogleCalendarError";
  }
}

export interface GoogleCalendarClient {
  connectionId: number;
  calendarId: string;
  displayName: string;
  sourceColor: string;
  sourceType: "primary" | "external";
  showOnAdminCalendar: boolean;
  blockAvailability: boolean;
  writeBookings: boolean;
  /** ISO UTC timestamps where the connected calendar is BUSY within [from, to]. */
  getBusy(from: Date, to: Date): Promise<{ start: Date; end: Date }[]>;
  /** Calendar events in [from, to], used by the admin calendar display. */
  getEvents(from: Date, to: Date): Promise<GoogleCalendarEvent[]>;
  /** Create an event, returning Google's event id + html link for storage on the booking. */
  createEvent(input: CreateEventInput): Promise<CreatedEvent>;
  /** Delete an event — best-effort, safe to call if the event was already deleted. */
  deleteEvent(eventId: string): Promise<void>;
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  location?: string;
  /** ISO UTC. */
  startISO: string;
  /** ISO UTC. */
  endISO: string;
  /** If provided, attaches the realtor as a guest (they'll see it on their calendar too). */
  attendeeEmail?: string;
  attendeeName?: string;
}

export interface CreatedEvent {
  id: string;
  htmlLink: string;
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start: Date;
  end: Date;
  allDay: boolean;
}

export interface GoogleCalendarSource {
  id: number;
  calendarId: string;
  displayName: string;
  sourceColor: string;
  googleAccountEmail: string;
  sourceType: "primary" | "external";
  showOnAdminCalendar: boolean;
  blockAvailability: boolean;
  writeBookings: boolean;
  connectedAt: string;
}

export interface CalendarConnectionScope {
  organizationId?: string;
}

function organizationId(scope?: CalendarConnectionScope): string {
  return scope?.organizationId ?? DEFAULT_ORGANIZATION_ID;
}

function isMissingOrganizationColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; message?: string };
  return (
    candidate.code === "42703" ||
    candidate.message?.includes("organization_id") === true
  );
}

function isMissingCalendarSourceColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; message?: string };
  return (
    candidate.code === "42703" &&
    (candidate.message?.includes("write_bookings") === true ||
      candidate.message?.includes("show_on_admin_calendar") === true ||
      candidate.message?.includes("block_availability") === true ||
      candidate.message?.includes("display_name") === true ||
      candidate.message?.includes("source_color") === true ||
      candidate.message?.includes("source_type") === true)
  );
}

export async function getGoogleCalendarConnection(
  scope?: CalendarConnectionScope,
): Promise<ConnectionRow | null> {
  const supabase = getServiceSupabase();
  const orgId = organizationId(scope);
  const scoped = await supabase
    .from("google_calendar_connection")
    .select("*")
    .eq("organization_id", orgId)
    .eq("write_bookings", true)
    .order("connected_at", { ascending: true })
    .limit(1)
    .maybeSingle<ConnectionRow>();

  if (!scoped.error) return scoped.data ?? null;

  if (isMissingCalendarSourceColumn(scoped.error)) {
    const single = await supabase
      .from("google_calendar_connection")
      .select("*")
      .eq("organization_id", orgId)
      .maybeSingle<ConnectionRow>();
    if (single.error && !isMissingOrganizationColumn(single.error)) {
      throw new Error(
        `Load google calendar connection failed: ${single.error.message}`,
      );
    }
    if (!single.error) return single.data ?? null;
  }

  // Backward compatibility while production is between code deploy and the
  // SaaS calendar migration. Remove this fallback once 0024 is everywhere.
  if (!isMissingOrganizationColumn(scoped.error)) {
    throw new Error(
      `Load google calendar connection failed: ${scoped.error.message}`,
    );
  }

  const legacy = await supabase
    .from("google_calendar_connection")
    .select("*")
    .eq("id", 1)
    .maybeSingle<ConnectionRow>();
  if (legacy.error) {
    throw new Error(
      `Load google calendar connection failed: ${legacy.error.message}`,
    );
  }
  return legacy.data ?? null;
}

export async function getGoogleCalendarConnections(
  scope?: CalendarConnectionScope & {
    showOnAdminCalendar?: boolean;
    blockAvailability?: boolean;
  },
): Promise<ConnectionRow[]> {
  const supabase = getServiceSupabase();
  const orgId = organizationId(scope);
  let query = supabase
    .from("google_calendar_connection")
    .select("*")
    .eq("organization_id", orgId)
    .order("write_bookings", { ascending: false })
    .order("connected_at", { ascending: true });

  if (typeof scope?.showOnAdminCalendar === "boolean") {
    query = query.eq("show_on_admin_calendar", scope.showOnAdminCalendar);
  }
  if (typeof scope?.blockAvailability === "boolean") {
    query = query.eq("block_availability", scope.blockAvailability);
  }

  const result = await query.returns<ConnectionRow[]>();
  if (!result.error) return result.data ?? [];

  if (isMissingCalendarSourceColumn(result.error)) {
    const fallback = await supabase
      .from("google_calendar_connection")
      .select("*")
      .eq("organization_id", orgId)
      .returns<ConnectionRow[]>();
    if (!fallback.error) return fallback.data ?? [];
    if (!isMissingOrganizationColumn(fallback.error)) {
      throw new Error(
        `Load google calendar connections failed: ${fallback.error.message}`,
      );
    }
  }

  if (!isMissingOrganizationColumn(result.error)) {
    throw new Error(
      `Load google calendar connections failed: ${result.error.message}`,
    );
  }

  const legacy = await supabase
    .from("google_calendar_connection")
    .select("*")
    .eq("id", 1)
    .maybeSingle<ConnectionRow>();
  if (legacy.error) {
    throw new Error(
      `Load google calendar connection failed: ${legacy.error.message}`,
    );
  }
  return legacy.data ? [legacy.data] : [];
}

export async function getGoogleCalendarSources(
  scope?: CalendarConnectionScope,
): Promise<GoogleCalendarSource[]> {
  const rows = await getGoogleCalendarConnections(scope);
  return rows.map(calendarSourceFromRow);
}

/**
 * Load the connection row + (if needed) refresh the access token. Returns
 * null when the admin hasn't connected a calendar yet — availability code
 * should treat this as "no additional busy blocks to union in" and move on.
 */
export async function getGoogleCalendarClient(
  scope?: CalendarConnectionScope,
): Promise<GoogleCalendarClient | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const conn = await getGoogleCalendarConnection(scope);
  if (!conn) return null;

  return clientFromConnection(conn, clientId, clientSecret);
}

export async function getGoogleCalendarClients(
  scope?: CalendarConnectionScope & {
    showOnAdminCalendar?: boolean;
    blockAvailability?: boolean;
  },
): Promise<GoogleCalendarClient[]> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [];

  const rows = await getGoogleCalendarConnections(scope);
  const clients = await Promise.all(
    rows.map((row) => clientFromConnection(row, clientId, clientSecret)),
  );
  return clients;
}

async function clientFromConnection(
  conn: ConnectionRow,
  clientId: string,
  clientSecret: string,
): Promise<GoogleCalendarClient> {
  const accessToken = await ensureAccessToken(conn, clientId, clientSecret);
  const calendarId = conn.calendar_id || "primary";

  return {
    connectionId: conn.id,
    calendarId,
    displayName: calendarSourceName(conn),
    sourceColor: calendarSourceColor(conn),
    sourceType: conn.source_type ?? "primary",
    showOnAdminCalendar: conn.show_on_admin_calendar ?? true,
    blockAvailability: conn.block_availability ?? true,
    writeBookings: conn.write_bookings ?? true,
    async getBusy(from, to) {
      return queryFreeBusy(accessToken, calendarId, from, to);
    },
    async getEvents(from, to) {
      return listEvents(accessToken, calendarId, from, to);
    },
    async createEvent(input) {
      return insertEvent(accessToken, calendarId, input);
    },
    async deleteEvent(eventId) {
      await deleteEventBestEffort(accessToken, calendarId, eventId);
    },
  };
}

function calendarSourceFromRow(conn: ConnectionRow): GoogleCalendarSource {
  return {
    id: conn.id,
    calendarId: conn.calendar_id || "primary",
    displayName: calendarSourceName(conn),
    sourceColor: calendarSourceColor(conn),
    googleAccountEmail: conn.google_account_email,
    sourceType: conn.source_type ?? "primary",
    showOnAdminCalendar: conn.show_on_admin_calendar ?? true,
    blockAvailability: conn.block_availability ?? true,
    writeBookings: conn.write_bookings ?? true,
    connectedAt: conn.connected_at,
  };
}

function calendarSourceColor(conn: ConnectionRow): string {
  return conn.source_color || (conn.write_bookings ? "#3f7356" : "#2f80b7");
}

function calendarSourceName(conn: ConnectionRow): string {
  return (
    conn.display_name?.trim() ||
    (conn.write_bookings ? "Main booking calendar" : null) ||
    conn.calendar_id ||
    conn.google_account_email ||
    "Google Calendar"
  );
}

async function ensureAccessToken(
  conn: ConnectionRow,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const now = Date.now();
  const expires = conn.access_token_expires_at
    ? new Date(conn.access_token_expires_at).getTime()
    : 0;
  if (conn.access_token && expires - REFRESH_MARGIN_MS > now) {
    return conn.access_token;
  }

  const refreshed = await refreshAccessToken({
    refreshToken: conn.refresh_token,
    clientId,
    clientSecret,
  });

  const expiresAt = new Date(
    Date.now() + refreshed.expires_in * 1000,
  ).toISOString();

  const supabase = getServiceSupabase();
  await supabase
    .from("google_calendar_connection")
    .update({
      access_token: refreshed.access_token,
      access_token_expires_at: expiresAt,
      // Google re-issues the refresh_token only on explicit re-consent; the
      // refresh call normally returns nothing here. Keep the existing one.
      ...(refreshed.refresh_token
        ? { refresh_token: refreshed.refresh_token }
        : {}),
    })
    .eq("id", conn.id);

  return refreshed.access_token;
}

async function queryFreeBusy(
  accessToken: string,
  calendarId: string,
  from: Date,
  to: Date,
): Promise<{ start: Date; end: Date }[]> {
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/freeBusy",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: [{ id: calendarId }],
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new GoogleCalendarError(
      `freeBusy query failed: ${body.slice(0, 500)}`,
      res.status,
    );
  }

  const json = (await res.json()) as {
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
  };
  const busy = json.calendars?.[calendarId]?.busy ?? [];
  return busy.map((b) => ({
    start: new Date(b.start),
    end: new Date(b.end),
  }));
}

async function listEvents(
  accessToken: string,
  calendarId: string,
  from: Date,
  to: Date,
): Promise<GoogleCalendarEvent[]> {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
  );
  url.searchParams.set("timeMin", from.toISOString());
  url.searchParams.set("timeMax", to.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("showDeleted", "false");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new GoogleCalendarError(
      `events.list failed: ${body.slice(0, 500)}`,
      res.status,
    );
  }

  const json = (await res.json()) as {
    items?: Array<{
      id?: string;
      summary?: string;
      description?: string;
      location?: string;
      htmlLink?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;
  };

  return (json.items ?? [])
    .map((event) => normalizeListedEvent(event))
    .filter((event): event is GoogleCalendarEvent => Boolean(event));
}

function normalizeListedEvent(event: {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}): GoogleCalendarEvent | null {
  if (!event.id) return null;
  const startRaw = event.start?.dateTime ?? event.start?.date;
  const endRaw = event.end?.dateTime ?? event.end?.date;
  if (!startRaw || !endRaw) return null;

  const allDay = Boolean(event.start?.date);
  return {
    id: event.id,
    summary: event.summary?.trim() || "Google Calendar event",
    description: event.description,
    location: event.location,
    htmlLink: event.htmlLink,
    start: allDay ? dateOnlyToUtc(event.start?.date ?? startRaw) : new Date(startRaw),
    end: allDay ? dateOnlyToUtc(event.end?.date ?? endRaw) : new Date(endRaw),
    allDay,
  };
}

function dateOnlyToUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

async function insertEvent(
  accessToken: string,
  calendarId: string,
  input: CreateEventInput,
): Promise<CreatedEvent> {
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description,
    location: input.location,
    start: { dateTime: input.startISO },
    end: { dateTime: input.endISO },
  };
  if (input.attendeeEmail) {
    body.attendees = [
      {
        email: input.attendeeEmail,
        displayName: input.attendeeName,
      },
    ];
  }

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new GoogleCalendarError(
      `events.insert failed: ${errText.slice(0, 500)}`,
      res.status,
    );
  }

  const json = (await res.json()) as { id?: string; htmlLink?: string };
  if (!json.id) {
    throw new GoogleCalendarError(
      "events.insert returned no id",
      res.status,
    );
  }
  return {
    id: json.id,
    htmlLink: json.htmlLink ?? "",
  };
}

async function deleteEventBestEffort(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  try {
    await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    // 2xx or 410 (already gone) both mean "the event isn't there anymore"
    // — either is fine for our purposes. We swallow everything because the
    // caller is handling a booking cancellation; the DB update shouldn't
    // hinge on Google responding.
  } catch {
    // Best-effort. Log + move on.
  }
}

export async function persistTokens(args: {
  organizationId?: string;
  googleAccountEmail: string;
  refreshToken: string;
  accessToken: string;
  expiresInSeconds: number;
  calendarId?: string;
  connectedBy?: string | null;
}): Promise<void> {
  const supabase = getServiceSupabase();
  const expiresAt = new Date(
    Date.now() + args.expiresInSeconds * 1000,
  ).toISOString();
  const basePayload = {
    google_account_email: args.googleAccountEmail,
    refresh_token: args.refreshToken,
    access_token: args.accessToken,
    access_token_expires_at: expiresAt,
    calendar_id: args.calendarId ?? "primary",
    connected_by: args.connectedBy ?? null,
  };
  const sourcePayload = {
    ...basePayload,
    organization_id: organizationId(args),
    display_name: "Main booking calendar",
    source_color: "#3f7356",
    source_type: "primary" as const,
    show_on_admin_calendar: true,
    block_availability: true,
    write_bookings: true,
  };

  const existing = await getGoogleCalendarConnection({
    organizationId: organizationId(args),
  });
  if (existing) {
    const updated = await supabase
      .from("google_calendar_connection")
      .update(sourcePayload)
      .eq("id", existing.id);
    if (!updated.error) return;
    if (isMissingCalendarSourceColumn(updated.error)) {
      const legacyUpdate = await supabase
        .from("google_calendar_connection")
        .update(basePayload)
        .eq("id", existing.id);
      if (!legacyUpdate.error) return;
      throw new Error(
        `Save google connection failed: ${legacyUpdate.error.message}`,
      );
    }
    throw new Error(`Save google connection failed: ${updated.error.message}`);
  }

  const inserted = await supabase
    .from("google_calendar_connection")
    .insert(sourcePayload);
  if (!inserted.error) return;
  const error = inserted.error;

  // Backward compatibility before migration 0024 is applied.
  if (!isMissingOrganizationColumn(error) && !isMissingCalendarSourceColumn(error)) {
    throw new Error(`Save google connection failed: ${error.message}`);
  }

  const legacy = await supabase
    .from("google_calendar_connection")
    .upsert(
      {
        id: 1,
        google_account_email: args.googleAccountEmail,
        refresh_token: args.refreshToken,
        access_token: args.accessToken,
        access_token_expires_at: expiresAt,
        calendar_id: args.calendarId ?? "primary",
        connected_by: args.connectedBy ?? null,
      },
      { onConflict: "id" },
    );
  if (legacy.error) {
    throw new Error(`Save google connection failed: ${legacy.error.message}`);
  }
}

export async function deleteGoogleCalendarConnection(
  scope?: CalendarConnectionScope,
): Promise<ConnectionRow | null> {
  const supabase = getServiceSupabase();
  const conn = await getGoogleCalendarConnection(scope);
  if (!conn) return null;
  await supabase.from("google_calendar_connection").delete().eq("id", conn.id);
  return conn;
}

export function tokensFromExchange(tr: TokenResponse): {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string | null;
} {
  return {
    accessToken: tr.access_token,
    expiresInSeconds: tr.expires_in,
    refreshToken: tr.refresh_token ?? null,
  };
}
