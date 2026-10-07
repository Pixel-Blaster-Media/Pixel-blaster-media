import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isCalendarDate } from "@/lib/booking/calendar-week-range";
import { loadCalendarWeek } from "@/app/admin/calendar/calendar-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Read-only, tenant-scoped, one-week windows. No calendar mutation is reachable
// from scrolling. Private shoot notes must never enter a shared HTTP cache.
export async function GET(request: NextRequest) {
  await requireAdmin();
  const week = request.nextUrl.searchParams.get("week") ?? "";
  const headers = { "Cache-Control": "private, no-store" };
  if (!isCalendarDate(week)) return NextResponse.json({ error: "Choose a valid week." }, { status: 400, headers });
  try {
    const data = await loadCalendarWeek({ week, q: (request.nextUrl.searchParams.get("q") ?? "").slice(0, 300) });
    if (data.databaseLoadFailed) return NextResponse.json({ error: "This week could not be loaded. Try again." }, { status: 503, headers });
    return NextResponse.json({ weekStart: data.weekStart, days: data.days, items: data.items, googleLoadFailed: data.googleLoadFailed }, { headers });
  } catch {
    return NextResponse.json({ error: "This week could not be loaded. Try again." }, { status: 503, headers });
  }
}
