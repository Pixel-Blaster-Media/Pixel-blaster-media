export interface GoogleCalendarHealthSource {
  calendarId: string;
  sourceType: "primary" | "external";
  blockAvailability: boolean;
  writeBookings: boolean;
  showOnAdminCalendar: boolean;
}

export interface GoogleCalendarHealthClient {
  getBusy(from: Date, to: Date): Promise<unknown>;
}

export interface GoogleCalendarHealthReport {
  ok: boolean;
  failures: string[];
  sourceCount: number;
  blockingSourceCount: number;
  writeTargetCount: number;
  adminVisibleSourceCount: number;
  computedDayCount: number;
}

interface GoogleCalendarHealthDependencies {
  loadSources(): Promise<GoogleCalendarHealthSource[]>;
  loadBlockingClients(): Promise<GoogleCalendarHealthClient[]>;
  loadCurrentAccessToken(): Promise<string | null>;
  inspectScopes(accessToken: string): Promise<string[]>;
  loadAvailabilityDayCount(): Promise<number>;
  now?: Date;
  busyTimeoutMs?: number;
}

const EXPECTED_SOURCE_COUNT = 2;
const EXPECTED_BLOCKING_SOURCE_COUNT = 2;
const EXPECTED_WRITE_TARGET_COUNT = 1;
const EXPECTED_ADMIN_VISIBLE_SOURCE_COUNT = 2;
const EXPECTED_COMPUTED_DAY_COUNT = 28;
const DEFAULT_BUSY_TIMEOUT_MS = 20_000;
const EVENT_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const FREE_BUSY_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.freebusy";

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Timed out")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runGoogleCalendarHealthCheck({
  loadSources,
  loadBlockingClients,
  loadCurrentAccessToken,
  inspectScopes,
  loadAvailabilityDayCount,
  now = new Date(),
  busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS,
}: GoogleCalendarHealthDependencies): Promise<GoogleCalendarHealthReport> {
  const failures: string[] = [];
  let sources: GoogleCalendarHealthSource[] = [];
  let clients: GoogleCalendarHealthClient[] = [];
  let computedDayCount = 0;

  try {
    sources = await loadSources();
  } catch {
    failures.push("Could not load configured Google Calendar sources");
  }

  const sourceCount = sources.length;
  const blockingSourceCount = sources.filter(
    (source) => source.blockAvailability,
  ).length;
  const writeTargetCount = sources.filter((source) => source.writeBookings).length;
  const adminVisibleSourceCount = sources.filter(
    (source) => source.showOnAdminCalendar,
  ).length;
  const primarySourceCount = sources.filter(
    (source) => source.sourceType === "primary",
  ).length;
  const externalSourceCount = sources.filter(
    (source) => source.sourceType === "external",
  ).length;
  const uniqueCalendarCount = new Set(
    sources.map((source) => source.calendarId.trim().toLowerCase()),
  ).size;

  if (sourceCount !== EXPECTED_SOURCE_COUNT) {
    failures.push(
      `Expected ${EXPECTED_SOURCE_COUNT} configured sources; found ${sourceCount}`,
    );
  }
  if (blockingSourceCount !== EXPECTED_BLOCKING_SOURCE_COUNT) {
    failures.push(
      `Expected ${EXPECTED_BLOCKING_SOURCE_COUNT} blocking sources; found ${blockingSourceCount}`,
    );
  }
  if (writeTargetCount !== EXPECTED_WRITE_TARGET_COUNT) {
    failures.push(
      `Expected ${EXPECTED_WRITE_TARGET_COUNT} write target; found ${writeTargetCount}`,
    );
  }
  if (adminVisibleSourceCount !== EXPECTED_ADMIN_VISIBLE_SOURCE_COUNT) {
    failures.push(
      `Expected ${EXPECTED_ADMIN_VISIBLE_SOURCE_COUNT} admin-visible sources; found ${adminVisibleSourceCount}`,
    );
  }
  if (primarySourceCount !== 1 || externalSourceCount !== 1) {
    failures.push("Expected one primary and one external calendar source");
  }
  if (uniqueCalendarCount !== sourceCount) {
    failures.push("Expected unique calendar identities for all configured sources");
  }

  try {
    // Client initialization refreshes and may persist the shared OAuth token.
    // This check never creates, updates, or deletes Calendar events.
    clients = await loadBlockingClients();
  } catch {
    failures.push("Could not initialize Google Calendar clients or refresh OAuth");
  }

  if (clients.length !== EXPECTED_BLOCKING_SOURCE_COUNT) {
    failures.push(
      `Expected ${EXPECTED_BLOCKING_SOURCE_COUNT} active blocking clients; found ${clients.length}`,
    );
  }

  if (clients.length > 0) {
    let accessToken: string | null = null;
    try {
      accessToken = await loadCurrentAccessToken();
    } catch {
      failures.push("Could not reload the refreshed Google access token");
    }
    if (!accessToken) {
      failures.push("Refreshed Google access token is missing");
    } else {
      try {
        const scopes = new Set(await inspectScopes(accessToken));
        if (!scopes.has(EVENT_SCOPE)) {
          failures.push("Google Calendar event scope is missing");
        }
        if (!scopes.has(FREE_BUSY_SCOPE)) {
          failures.push("Google Calendar free-busy scope is missing");
        }
      } catch {
        failures.push("Could not inspect the refreshed Google OAuth scopes");
      }
    }

    const from = now;
    const to = new Date(now.getTime() + 60 * 60_000);
    await Promise.all(
      clients.map(async (client, index) => {
        try {
          await withTimeout(client.getBusy(from, to), busyTimeoutMs);
        } catch {
          failures.push(`Google freeBusy source ${index + 1} failed`);
        }
      }),
    );
  }

  try {
    computedDayCount = await loadAvailabilityDayCount();
    if (computedDayCount !== EXPECTED_COMPUTED_DAY_COUNT) {
      failures.push(
        `Expected ${EXPECTED_COMPUTED_DAY_COUNT} computed availability days; found ${computedDayCount}`,
      );
    }
  } catch {
    failures.push("Could not calculate booking availability");
  }

  return {
    ok: failures.length === 0,
    failures,
    sourceCount,
    blockingSourceCount,
    writeTargetCount,
    adminVisibleSourceCount,
    computedDayCount,
  };
}
