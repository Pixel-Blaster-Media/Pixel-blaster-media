import type { Metadata } from "next";

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
    <div className="space-y-10">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
          Settings
        </p>
        <h1 className="mt-1 text-2xl font-bold text-white">Availability</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Your working hours and one-off busy blocks. Realtors see the result
          as open slots on the portal calendar — they never see raw blocks
          or labels.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
          Weekly hours
        </h2>
        <ul className="mt-4 divide-y divide-white/5 rounded-lg border border-white/10 bg-ink-soft/50">
          {hours.map((h) => (
            <li key={h.day_of_week} className="p-4">
              <HoursEditor
                dayOfWeek={h.day_of_week}
                dayName={DAY_NAMES[h.day_of_week]}
                startTime={h.start_time.slice(0, 5)}
                endTime={h.end_time.slice(0, 5)}
                enabled={h.enabled}
              />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
          Busy blocks
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          Vacations, personal appointments, holidays — anything that shouldn't
          be bookable. Only you can see these.
        </p>
        <div className="mt-4">
          <BlocksManager blocks={blocksRes.data ?? []} />
        </div>
      </section>
    </div>
  );
}
