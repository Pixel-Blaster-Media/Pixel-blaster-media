// Date-only arithmetic deliberately uses UTC, not elapsed Toronto hours. A week
// is seven local dates even when the clocks change during that week.
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function shiftCalendarDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calendarWeekStart(value: string): string {
  return shiftCalendarDate(value, -new Date(`${value}T12:00:00Z`).getUTCDay());
}
