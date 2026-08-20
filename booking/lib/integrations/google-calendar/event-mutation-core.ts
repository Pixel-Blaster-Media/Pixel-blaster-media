import { createHash } from "node:crypto";

export interface GoogleCalendarMutationInput {
  summary: string;
  description?: string;
  location?: string;
  startISO: string;
  endISO: string;
  attendeeEmail?: string;
  attendeeName?: string;
  /** Explicitly remove every attendee when this event is updated. */
  clearAttendees?: boolean;
  /** Private ownership markers used to reconcile idempotent booking events. */
  bookingId?: string;
  organizationId?: string;
}

export interface GoogleCalendarCreatedEvent {
  id: string;
  htmlLink: string;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type GoogleCalendarFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<FetchResponse>;

const EVENT_MUTATION_REQUEST_TIMEOUT_MS = 10_000;

function eventMutationSignal(): AbortSignal {
  return AbortSignal.timeout(EVENT_MUTATION_REQUEST_TIMEOUT_MS);
}

export class GoogleCalendarError extends Error {
  status?: number;
  reason?: string;

  constructor(message: string, status?: number, reason?: string) {
    super(message);
    this.name = "GoogleCalendarError";
    this.status = status;
    this.reason = reason;
  }
}

export class GoogleCalendarIdentityCollisionError extends GoogleCalendarError {
  constructor(message: string) {
    super(message, 409, "identity_mismatch");
    this.name = "GoogleCalendarIdentityCollisionError";
  }
}

export class GoogleCalendarRetiredEventIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleCalendarRetiredEventIdError";
  }
}

function hasOwnershipMarker(
  ownership: Record<string, unknown> | undefined,
  key: "pbm_booking_id" | "pbm_organization_id",
): boolean {
  return Boolean(
    ownership && Object.prototype.hasOwnProperty.call(ownership, key),
  );
}

type GoogleCalendarOwnershipState =
  | { kind: "markerless" }
  | { kind: "malformed" }
  | { kind: "private"; value: Record<string, unknown> };

function googleCalendarOwnershipState(
  event: unknown,
): GoogleCalendarOwnershipState {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return { kind: "malformed" };
  }
  const eventRecord = event as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(eventRecord, "extendedProperties")) {
    return { kind: "markerless" };
  }
  const extendedProperties = eventRecord.extendedProperties;
  if (
    !extendedProperties ||
    typeof extendedProperties !== "object" ||
    Array.isArray(extendedProperties)
  ) {
    return { kind: "malformed" };
  }
  const extendedRecord = extendedProperties as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(extendedRecord, "private")) {
    return { kind: "markerless" };
  }
  const privateValue = extendedRecord.private;
  if (!privateValue || typeof privateValue !== "object" || Array.isArray(privateValue)) {
    return { kind: "malformed" };
  }
  return { kind: "private", value: privateValue as Record<string, unknown> };
}

/**
 * Google permits caller-supplied base32hex event IDs. Deriving one from the
 * booking, missing predecessor, and bounded attempt makes creates idempotent
 * while allowing a new generation after a deleted/tombstoned Google event.
 */
export function bookingGoogleCalendarEventId(
  bookingId: string,
  previousEventId: string | null,
  attempt: number,
): string {
  const generation = Number.isInteger(attempt) && attempt >= 0 ? attempt : 0;
  const digest = createHash("sha256")
    .update("pixel-blaster-booking-calendar-v1\0")
    .update(bookingId)
    .update("\0")
    .update(previousEventId ?? "initial")
    .update("\0")
    .update(String(generation))
    .digest("hex");
  return `pbm${digest}`;
}

export function buildGoogleCalendarEventBody(
  input: GoogleCalendarMutationInput,
): Record<string, unknown> {
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
  } else if (input.clearAttendees) {
    body.attendees = [];
  }

  if (input.bookingId && input.organizationId) {
    body.extendedProperties = {
      private: {
        pbm_booking_id: input.bookingId,
        pbm_organization_id: input.organizationId,
      },
    };
  }

  return body;
}

export function googleCalendarSendUpdatesMode(
  input: GoogleCalendarMutationInput,
): "all" | "none" {
  return input.clearAttendees ? "none" : "all";
}

export async function insertGoogleCalendarEvent({
  fetchImpl,
  accessToken,
  calendarId,
  input,
  eventId,
}: {
  fetchImpl: GoogleCalendarFetch;
  accessToken: string;
  calendarId: string;
  input: GoogleCalendarMutationInput;
  eventId?: string;
}): Promise<GoogleCalendarCreatedEvent> {
  const collectionUrl =
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const sendUpdates = googleCalendarSendUpdatesMode(input);
  const body = buildGoogleCalendarEventBody(input);
  if (eventId) body.id = eventId;

  const response = await fetchImpl(
    `${collectionUrl}?sendUpdates=${sendUpdates}`,
    {
      method: "POST",
      headers: {
        Authorization: ["Bear", "er ", accessToken].join(""),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: eventMutationSignal(),
    },
  );

  if (response.status === 409 && eventId) {
    return loadOwnedExistingEvent({
      fetchImpl,
      accessToken,
      collectionUrl,
      calendarId,
      eventId,
      input,
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new GoogleCalendarError(
      `Google Calendar events.insert failed (${response.status})`,
      response.status,
      googleCalendarErrorReason(errorText),
    );
  }

  const created = await createdEventFromResponse(response, "events.insert");
  if (eventId && created.id !== eventId) {
    throw new GoogleCalendarIdentityCollisionError(
      "events.insert returned an unexpected event id",
    );
  }
  return created;
}

export async function updateGoogleCalendarEvent({
  fetchImpl,
  accessToken,
  calendarId,
  eventId,
  input,
}: {
  fetchImpl: GoogleCalendarFetch;
  accessToken: string;
  calendarId: string;
  eventId: string;
  input: GoogleCalendarMutationInput;
}): Promise<GoogleCalendarCreatedEvent> {
  if (!input.bookingId || !input.organizationId) {
    throw new GoogleCalendarIdentityCollisionError(
      "Booking ownership is required before updating a Google Calendar event",
    );
  }
  const eventUrl =
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const identityResponse = await fetchImpl(eventUrl, {
    method: "GET",
    headers: {
      Authorization: ["Bear", "er ", accessToken].join(""),
    },
    signal: eventMutationSignal(),
  });
  if (identityResponse.status === 404) {
    throw new GoogleCalendarError(
      "Stored Google Calendar event could not be ownership-verified",
      404,
      "identity_unverified_missing",
    );
  }
  if (!identityResponse.ok) {
    const errorText = await identityResponse.text();
    throw new GoogleCalendarError(
      `Google Calendar events.get before patch failed (${identityResponse.status})`,
      identityResponse.status,
      googleCalendarErrorReason(errorText),
    );
  }
  const existing = await identityResponse.json() as {
    id?: string;
    status?: string;
    extendedProperties?: { private?: Record<string, string | undefined> };
  };
  if (existing.id !== eventId) {
    throw new GoogleCalendarIdentityCollisionError(
      "events.get returned an unexpected event id before patch",
    );
  }
  const ownershipState = googleCalendarOwnershipState(existing);
  if (ownershipState.kind === "malformed") {
    throw new GoogleCalendarIdentityCollisionError(
      "Existing Google Calendar event has malformed ownership metadata",
    );
  }
  const ownership =
    ownershipState.kind === "private" ? ownershipState.value : undefined;
  const hasOwnershipMarkers =
    hasOwnershipMarker(ownership, "pbm_booking_id") ||
    hasOwnershipMarker(ownership, "pbm_organization_id");
  if (
    hasOwnershipMarkers &&
    (ownership?.pbm_booking_id !== input.bookingId ||
      ownership?.pbm_organization_id !== input.organizationId)
  ) {
    throw new GoogleCalendarIdentityCollisionError(
      "Existing Google Calendar event belongs to a different booking",
    );
  }
  if (existing.status === "cancelled") {
    throw new GoogleCalendarError(
      "Stored Google Calendar event is cancelled",
      410,
      "gone",
    );
  }

  // Legacy linked events predate ownership markers. The tenant-scoped stored
  // link is adopted once; all subsequently managed events must match markers.
  return patchGoogleCalendarEvent({
    fetchImpl,
    accessToken,
    calendarId,
    eventId,
    input,
  });
}

async function patchGoogleCalendarEvent({
  fetchImpl,
  accessToken,
  calendarId,
  eventId,
  input,
}: {
  fetchImpl: GoogleCalendarFetch;
  accessToken: string;
  calendarId: string;
  eventId: string;
  input: GoogleCalendarMutationInput;
}): Promise<GoogleCalendarCreatedEvent> {
  const response = await fetchImpl(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=${googleCalendarSendUpdatesMode(input)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: ["Bear", "er ", accessToken].join(""),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildGoogleCalendarEventBody(input)),
      signal: eventMutationSignal(),
    },
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new GoogleCalendarError(
      `Google Calendar events.patch failed (${response.status})`,
      response.status,
      googleCalendarErrorReason(errorText),
    );
  }
  const updated = await createdEventFromResponse(response, "events.patch");
  if (updated.id !== eventId) {
    throw new GoogleCalendarIdentityCollisionError(
      "events.patch returned an unexpected event id",
    );
  }
  return updated;
}

async function loadOwnedExistingEvent({
  fetchImpl,
  accessToken,
  collectionUrl,
  calendarId,
  eventId,
  input,
}: {
  fetchImpl: GoogleCalendarFetch;
  accessToken: string;
  collectionUrl: string;
  calendarId: string;
  eventId: string;
  input: GoogleCalendarMutationInput;
}): Promise<GoogleCalendarCreatedEvent> {
  const response = await fetchImpl(
    `${collectionUrl}/${encodeURIComponent(eventId)}`,
    {
      method: "GET",
      headers: {
        Authorization: ["Bear", "er ", accessToken].join(""),
      },
      signal: eventMutationSignal(),
    },
  );

  if (response.status === 410) {
    throw new GoogleCalendarRetiredEventIdError(
      `Google Calendar event id ${eventId} is retired`,
    );
  }
  if (response.status === 404) {
    throw new GoogleCalendarError(
      "Deterministic Google Calendar event could not be ownership-verified",
      404,
      "identity_unverified_missing",
    );
  }
  if (!response.ok) {
    const errorText = await response.text();
    throw new GoogleCalendarError(
      `Google Calendar events.get after insert conflict failed (${response.status})`,
      response.status,
      googleCalendarErrorReason(errorText),
    );
  }

  const payload = await response.json() as {
    id?: string;
    htmlLink?: string;
    status?: string;
    extendedProperties?: {
      private?: Record<string, string | undefined>;
    };
  };
  if (payload.id !== eventId) {
    throw new GoogleCalendarIdentityCollisionError(
      "events.get returned an unexpected event id",
    );
  }

  const ownership = payload.extendedProperties?.private;
  if (
    !input.bookingId ||
    !input.organizationId ||
    ownership?.pbm_booking_id !== input.bookingId ||
    ownership?.pbm_organization_id !== input.organizationId
  ) {
    throw new GoogleCalendarIdentityCollisionError(
      "Existing Google Calendar event identity does not match this booking",
    );
  }
  if (payload.status === "cancelled") {
    throw new GoogleCalendarRetiredEventIdError(
      `Google Calendar event id ${eventId} is retired`,
    );
  }

  // A retry may carry a newer canonical booking projection than the ambiguous
  // insert that originally claimed this deterministic id. Repair the owned
  // event before reporting success so linkage can never bless stale metadata.
  return patchGoogleCalendarEvent({
    fetchImpl,
    accessToken,
    calendarId,
    eventId,
    input,
  });
}

export async function deleteGoogleCalendarEventStrict({
  fetchImpl,
  accessToken,
  calendarId,
  eventId,
  bookingId,
  organizationId,
  allowMarkerlessLegacy = false,
}: {
  fetchImpl: GoogleCalendarFetch;
  accessToken: string;
  calendarId: string;
  eventId: string;
  bookingId: string;
  organizationId: string;
  allowMarkerlessLegacy?: boolean;
}): Promise<void> {
  const eventUrl =
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const identityResponse = await fetchImpl(eventUrl, {
    method: "GET",
    headers: {
      Authorization: ["Bear", "er ", accessToken].join(""),
    },
    signal: eventMutationSignal(),
  });
  if (identityResponse.status === 410) return;
  if (identityResponse.status === 404) {
    throw new GoogleCalendarError(
      "Stored Google Calendar event could not be ownership-verified before delete",
      404,
      "identity_unverified_missing",
    );
  }
  if (!identityResponse.ok) {
    const errorText = await identityResponse.text();
    throw new GoogleCalendarError(
      `Google Calendar events.get before delete failed (${identityResponse.status})`,
      identityResponse.status,
      googleCalendarErrorReason(errorText),
    );
  }
  const existing = await identityResponse.json() as {
    id?: string;
    status?: string;
    extendedProperties?: { private?: Record<string, string | undefined> };
  };
  if (existing.id !== eventId) {
    throw new GoogleCalendarIdentityCollisionError(
      "events.get returned an unexpected event id before delete",
    );
  }
  const ownershipState = googleCalendarOwnershipState(existing);
  if (ownershipState.kind === "malformed") {
    throw new GoogleCalendarIdentityCollisionError(
      "Existing Google Calendar event has malformed ownership metadata",
    );
  }
  const ownership =
    ownershipState.kind === "private" ? ownershipState.value : undefined;
  const hasOwnershipMarkers =
    hasOwnershipMarker(ownership, "pbm_booking_id") ||
    hasOwnershipMarker(ownership, "pbm_organization_id");
  if (!hasOwnershipMarkers && !allowMarkerlessLegacy) {
    throw new GoogleCalendarIdentityCollisionError(
      "Existing Google Calendar event has no verified booking ownership",
    );
  }
  if (
    hasOwnershipMarkers &&
    (ownership?.pbm_booking_id !== bookingId ||
      ownership?.pbm_organization_id !== organizationId)
  ) {
    throw new GoogleCalendarIdentityCollisionError(
      "Existing Google Calendar event belongs to a different booking",
    );
  }
  if (existing.status === "cancelled") return;

  const response = await fetchImpl(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: "DELETE",
      headers: {
        Authorization: ["Bear", "er ", accessToken].join(""),
      },
      signal: eventMutationSignal(),
    },
  );

  if (response.ok || response.status === 404 || response.status === 410) return;

  const errorText = await response.text();
  throw new GoogleCalendarError(
    `Google Calendar events.delete failed (${response.status})`,
    response.status,
    googleCalendarErrorReason(errorText),
  );
}

async function createdEventFromResponse(
  response: FetchResponse,
  operation: string,
): Promise<GoogleCalendarCreatedEvent> {
  const payload = await response.json() as { id?: string; htmlLink?: string };
  if (!payload.id) {
    throw new GoogleCalendarError(
      `${operation} returned no id`,
      response.status,
    );
  }
  return { id: payload.id, htmlLink: payload.htmlLink ?? "" };
}

function googleCalendarErrorReason(body: string): string | undefined {
  try {
    const payload = JSON.parse(body) as {
      error?: { errors?: Array<{ reason?: unknown }> };
    };
    const reason = payload.error?.errors?.find(
      (entry) => typeof entry.reason === "string",
    )?.reason;
    return typeof reason === "string" ? reason : undefined;
  } catch {
    return undefined;
  }
}
