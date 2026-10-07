import type { Metadata } from "next";
import AdminPageHeading from "../AdminPageHeading";
import CalendarWeekView from "./CalendarWeekView";
import { CalendarSidebar, loadCalendarWeek } from "./calendar-data";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

export default async function AdminCalendarPage({ searchParams }: { searchParams: Promise<{ week?: string; q?: string }> }) {
  const data = await loadCalendarWeek(await searchParams);
  return <div className="space-y-5">
    <AdminPageHeading eyebrow="Schedule" title="Calendar" meta="Scroll across weeks. Keep your day in view." />
    {data.databaseLoadFailed || data.googleLoadFailed ? <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-semibold">Calendar data needs attention.</p>
      <p>{data.databaseLoadFailed ? "Some booking or availability data could not be loaded. Refresh before relying on this schedule." : "One Google Calendar could not be loaded. Pixel Blaster bookings are still shown from the booking database."}</p>
    </div> : null}
    <CalendarWeekView days={data.days} items={data.items} catalogItems={data.catalogItems} navigation={data.navigation}
      calendarMenu={<CalendarSidebar sources={data.calendarSources} weekStart={data.weekStart} todayKey={data.todayKey} visibleItems={data.items} />} />
  </div>;
}
