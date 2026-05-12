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
  calendarId: string;
  /** ISO UTC timestamps where the connected calendar is BUSY within [from, to]. */
  getBusy(from: Date, to: Date): Promise<{ start: Date; end: Date }[]>;
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

export async function getGoogleCalendarConnection(
  scope?: CalendarConnectionScope,
): Promise<ConnectionRow | null> {
  const supabase = getServiceSupabase();
  const orgId = organizationId(scope);
  const scoped = await supabase
    .from("google_calendar_connection")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle<ConnectionRow>();

  if (!scoped.error) return scoped.data ?? null;

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

  const accessToken = await ensureAccessToken(conn, clientId, clientSecret);
  const calendarId = conn.calendar_id || "primary";

  return {
    calendarId,
    async getBusy(from, to) {
      return queryFreeBusy(accessToken, calendarId, from, to);
    },
    async createEvent(input) {
      return insertEvent(accessToken, calendarId, input);
    },
    async deleteEvent(eventId) {
      await deleteEventBestEffort(accessToken, calendarId, eventId);
    },
  };
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
  const { error } = await supabase
    .from("google_calendar_connection")
    .upsert(
      {
        organization_id: organizationId(args),
        google_account_email: args.googleAccountEmail,
        refresh_token: args.refreshToken,
        access_token: args.accessToken,
        access_token_expires_at: expiresAt,
        calendar_id: args.calendarId ?? "primary",
        connected_by: args.connectedBy ?? null,
      },
      { onConflict: "organization_id" },
    );
  if (!error) return;

  // Backward compatibility before migration 0024 is applied.
  if (!isMissingOrganizationColumn(error)) {
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
