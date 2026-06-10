import { NextRequest, NextResponse } from "next/server";

/**
 * Downloadable .ics for the booking-success page so Apple Calendar /
 * Outlook users get one-tap "add to calendar" alongside the Google link.
 * Everything in the file comes from query params the success redirect
 * built server-side, but values are still validated and escaped here
 * since the URL is user-editable.
 */
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const start = parseDate(params.get("start"));
  const end = parseDate(params.get("end"));
  if (!start || !end || end <= start) {
    return NextResponse.json({ error: "Invalid times" }, { status: 400 });
  }

  const address = clean(params.get("address"), 200);
  const services = clean(params.get("services"), 300);
  const org = clean(params.get("org"), 100) || "Pixel Blaster Media";

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pixel Blaster Media//Booking//EN",
    "BEGIN:VEVENT",
    `UID:${start.getTime()}-${end.getTime()}@pixelblastermedia.com`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(`${org} — media shoot`)}`,
    address ? `LOCATION:${icsText(address)}` : null,
    services ? `DESCRIPTION:${icsText(`Services: ${services}`)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => line !== null);

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="shoot.ics"',
      "Cache-Control": "no-store",
    },
  });
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Strip control chars (incl. CR/LF injection vectors) and cap length. */
function clean(value: string | null, maxLength: number): string {
  // eslint-disable-next-line no-control-regex
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, maxLength)
    .trim();
}

/** RFC 5545 escaping for text values. */
function icsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
