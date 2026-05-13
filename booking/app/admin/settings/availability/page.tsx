import type { Metadata } from "next";
import Link from "next/link";

import { getServerSupabase } from "@/lib/supabase/server";

import BlocksManager from "./BlocksManager";
import HoursEditor from "./HoursEditor";

export const metadata: Metadata = { title: "Availability" };
export const dynamic = "force-dynamic";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface BusinessHoursRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  enabled: boolean;
}

interface CalendarBlockRow {
  id: string;
  starts_at: string;
  ends_at: string;
  label: string | null;
}

export default async function AvailabilityPage() {
  const supabase = await getServerSupabase();

  const [hoursRes, blocksRes] = await Promise.all([
    supabase
      .from("business_hours")
      .select("day_of_week, start_time, end_time, enabled")
      .order("day_of_week")
      .returns<BusinessHoursRow[]>(),
    supabase
      .from("calendar_blocks")
      .select("id, starts_at, ends_at, label")
      .gte("ends_at", new Date().toISOString())
      .order("starts_at")
      .returns<CalendarBlockRow[]>(),
  ]);

  const hours: BusinessHoursRow[] = [];
  const byDow = new Map(
    (hoursRes.data ?? []).map((h) => [h.day_of_week, h]),
  );
  for (let d = 0; d < 7; d++) {
    hours.push(
      byDow.get(d) ?? {
        day_of_week: d,
        start_time: "09:00:00",
        end_time: "17:00:00",
        enabled: false,
      },
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <header className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-lg shadow-realtor-text/10">
        <Link
          href="/admin/settings"
          className="text-xs font-semibold uppercase tracking-[0.2em] text-realtor-primary/80 hover:text-realtor-text"
        >
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-realtor-text md:text-3xl">
          Availability
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-realtor-muted">
          Set working hours and private busy blocks. Realtors only see open
          booking slots — never your private labels.
        </p>
      </header>

      <section className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary/80">
            Weekly hours
          </p>
          <h2 className="mt-1 text-lg font-semibold text-realtor-text">
            When bookings are allowed
          </h2>
          <p className="mt-1 text-sm leading-6 text-realtor-muted">
            Toggle each day open or closed, then save the days you change.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {hours.map((h) => (
            <HoursEditor
              key={h.day_of_week}
              dayOfWeek={h.day_of_week}
              dayName={DAY_NAMES[h.day_of_week]}
              startTime={h.start_time.slice(0, 5)}
              endTime={h.end_time.slice(0, 5)}
              enabled={h.enabled}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary/80">
            Busy blocks
          </p>
          <h2 className="mt-1 text-lg font-semibold text-realtor-text">
            Time you do not want booked
          </h2>
          <p className="mt-1 text-sm leading-6 text-realtor-muted">
            Vacations, personal appointments, holidays — anything that should
            hide from the booking calendar.
          </p>
        </div>
        <BlocksManager blocks={blocksRes.data ?? []} />
      </section>
    </div>
  );
}
