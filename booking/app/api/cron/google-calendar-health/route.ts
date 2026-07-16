import { NextResponse } from "next/server";

import { loadSlotsForNextDays } from "@/lib/booking/slot-display";
import {
  getGoogleCalendarClients,
  getGoogleCalendarConnection,
  getGoogleCalendarSources,
} from "@/lib/integrations/google-calendar/client";
import { runGoogleCalendarHealthCheck } from "@/lib/integrations/google-calendar/health-check";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const secret = process.env.GOOGLE_CALENDAR_WATCHDOG_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, failures: ["Google Calendar watchdog is not configured"] },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { ok: false, failures: ["Unauthorized"] },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const report = await runGoogleCalendarHealthCheck({
    loadSources: () =>
      getGoogleCalendarSources({ organizationId: DEFAULT_ORGANIZATION_ID }),
    loadBlockingClients: () =>
      getGoogleCalendarClients({
        organizationId: DEFAULT_ORGANIZATION_ID,
        blockAvailability: true,
      }),
    loadCurrentAccessToken: async () => {
      const connection = await getGoogleCalendarConnection({
        organizationId: DEFAULT_ORGANIZATION_ID,
      });
      return connection?.access_token ?? null;
    },
    inspectScopes: async (accessToken) => {
      const response = await fetch("https://oauth2.googleapis.com/tokeninfo", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ access_token: accessToken }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error("Google token inspection failed");
      const payload = (await response.json()) as { scope?: string };
      return String(payload.scope ?? "")
        .split(/\s+/)
        .filter(Boolean);
    },
    loadAvailabilityDayCount: async () => {
      const days = await loadSlotsForNextDays(80, 28, {
        organizationId: DEFAULT_ORGANIZATION_ID,
      });
      return days.length;
    },
  });

  return NextResponse.json(report, {
    status: report.ok ? 200 : 503,
    headers: NO_STORE_HEADERS,
  });
}
