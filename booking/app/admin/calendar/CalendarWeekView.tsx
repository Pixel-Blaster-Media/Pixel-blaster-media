"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { addCalendarBlock } from "@/app/admin/settings/availability/actions";

interface CalendarItem {
  id: string;
  kind: "booking" | "block";
  title: string;
  subtitle: string;
  startsAt: string;
  endsAt: string;
  localDate: string;
  href?: string;
  statusLabel?: string;
  statusClass?: string;
}

interface DayColumn {
  key: string;
  label: string;
  shortLabel: string;
  dateInput: string;
  enabled: boolean;
  workStartMinutes: number;
  workEndMinutes: number;
}

const START_HOUR = 7;
const END_HOUR = 20;
const SLOT_MINUTES = 30;
const HOUR_HEIGHT = 72;

export default function CalendarWeekView({
  days,
  items,
}: {
  days: DayColumn[];
  items: CalendarItem[];
}) {
  const [selected, setSelected] = useState<{
    day: DayColumn;
    hour: number;
    minute: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const key = item.localDate;
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [items]);

  const gridHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
  const selectedSlot = selected
    ? toDateTimeLocal(selected.day.dateInput, selected.hour, selected.minute)
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-brand/10 ring-1 ring-brand/20" />
          Working hours
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-white/[0.04] ring-1 ring-white/10" />
          Outside hours
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-brand/25 ring-1 ring-brand-light/50" />
          Shoot
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-white/10 bg-ink-soft/40">
        <div className="grid min-w-[980px] grid-cols-[64px_repeat(7,minmax(120px,1fr))]">
          <div className="border-b border-white/10 bg-ink px-2 py-3" />
          {days.map((day) => (
            <div
              key={day.key}
              className="border-b border-l border-white/10 bg-ink px-3 py-3"
            >
              <p className="text-xs uppercase tracking-wider text-ink-muted">
                {day.shortLabel}
              </p>
              <p className="text-sm font-semibold text-white">{day.label}</p>
            </div>
          ))}

          <div className="relative bg-ink" style={{ height: gridHeight }}>
            {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => (
              <div
                key={i}
                className="absolute right-2 text-[10px] text-ink-muted"
                style={{ top: i * HOUR_HEIGHT - 6 }}
              >
                {formatHour(START_HOUR + i)}
              </div>
            ))}
          </div>

          {days.map((day) => (
            <div
              key={day.key}
              className="relative border-l border-white/10"
              style={{ height: gridHeight }}
            >
              {day.enabled ? (
                <div
                  className="absolute left-0 right-0 bg-brand/10 ring-1 ring-inset ring-brand/15"
                  style={{
                    top:
                      ((day.workStartMinutes - START_HOUR * 60) / 60) *
                      HOUR_HEIGHT,
                    height:
                      ((day.workEndMinutes - day.workStartMinutes) / 60) *
                      HOUR_HEIGHT,
                  }}
                />
              ) : (
                <div className="absolute inset-0 bg-white/[0.025]" />
              )}
              {Array.from({ length: (END_HOUR - START_HOUR) * 2 }).map(
                (_, slot) => {
                  const minutes = slot * SLOT_MINUTES;
                  const hour = START_HOUR + Math.floor(minutes / 60);
                  const minute = minutes % 60;
                  return (
                    <button
                      key={slot}
                      type="button"
                      aria-label={`Add block ${day.label} ${formatTime(
                        hour,
                        minute,
                      )}`}
                      onClick={() => {
                        setError(null);
                        setSelected({ day, hour, minute });
                      }}
                      className="absolute left-0 right-0 border-t border-white/[0.06] transition hover:bg-brand/15"
                      style={{
                        top: (minutes / 60) * HOUR_HEIGHT,
                        height: (SLOT_MINUTES / 60) * HOUR_HEIGHT,
                      }}
                    />
                  );
                },
              )}

              {(itemsByDay.get(day.dateInput) ?? []).map((item) => (
                <CalendarEvent key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-ink-soft/40 p-4 md:hidden">
        <p className="text-sm font-semibold text-white">This week</p>
        <div className="mt-3 space-y-3">
          {days.map((day) => {
            const dayItems = itemsByDay.get(day.dateInput) ?? [];
            return (
              <div key={day.key}>
                <p className="text-xs uppercase tracking-wider text-ink-muted">
                  {day.shortLabel} {day.label}
                  {day.enabled
                    ? ` · ${minutesToLabel(day.workStartMinutes)}-${minutesToLabel(
                        day.workEndMinutes,
                      )}`
                    : " · closed"}
                </p>
                {dayItems.length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {dayItems.map((item) => (
                      <li key={`${item.kind}-${item.id}`}>
                        {item.href ? (
                          <Link
                            href={item.href}
                            className="block rounded-md border border-white/10 bg-ink px-3 py-2"
                          >
                            <MobileItem item={item} />
                          </Link>
                        ) : (
                          <div className="rounded-md border border-white/10 bg-ink px-3 py-2">
                            <MobileItem item={item} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-ink-muted">No items.</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {selected ? (
        <div className="rounded-lg border border-brand/20 bg-brand/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">
                {selected.day.label} at{" "}
                {formatTime(selected.hour, selected.minute)}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Add a private busy block here. Shoots are added through the
                booking flow for now, so realtor/property details stay complete.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-ink-muted hover:text-white"
            >
              Close
            </button>
          </div>

          <form
            className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]"
            action={(formData) => {
              setError(null);
              startTransition(async () => {
                const result = await addCalendarBlock(formData);
                if (!result.ok) {
                  setError(result.error ?? "Could not add block.");
                  return;
                }
                setSelected(null);
              });
            }}
          >
            <input
              type="hidden"
              name="starts_at"
              value={selectedSlot ?? ""}
            />
            <label className="block">
              <span className="text-xs text-ink-muted">Ends</span>
              <input
                type="datetime-local"
                name="ends_at"
                defaultValue={toDateTimeLocal(
                  selected.day.dateInput,
                  selected.hour + 1,
                  selected.minute,
                )}
                required
                className="mt-1 w-full rounded-md border border-white/10 bg-ink px-2 py-1.5 text-sm text-white"
              />
            </label>
            <label className="block">
              <span className="text-xs text-ink-muted">Private label</span>
              <input
                type="text"
                name="label"
                defaultValue="Busy"
                className="mt-1 w-full rounded-md border border-white/10 bg-ink px-2 py-1.5 text-sm text-white"
              />
            </label>
            <button
              type="submit"
              disabled={pending}
              className="self-end rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-60"
            >
              {pending ? "Adding..." : "Add block"}
            </button>
            {error ? (
              <p className="md:col-span-3 text-sm text-red-300" role="alert">
                {error}
              </p>
            ) : null}
          </form>

          <div className="mt-3">
            <Link
              href={`/book?slot=${encodeURIComponent(selectedSlot ?? "")}`}
              className="text-xs text-brand-light underline hover:text-white"
            >
              Open booking form with this time
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MobileItem({ item }: { item: CalendarItem }) {
  return (
    <>
      <p className="text-xs font-semibold text-white">
        {formatDateTimeRange(item.startsAt, item.endsAt)} · {item.title}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-ink-muted">
        {item.subtitle}
      </p>
    </>
  );
}

function CalendarEvent({ item }: { item: CalendarItem }) {
  const start = parseLocalParts(item.startsAt);
  const end = parseLocalParts(item.endsAt);
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  const top = ((startMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
  const height = Math.max(((endMinutes - startMinutes) / 60) * HOUR_HEIGHT, 32);
  const classes =
    item.kind === "booking"
      ? "border-brand-light/50 bg-brand/25 text-white hover:bg-brand/35"
      : "border-white/15 bg-white/[0.08] text-ink-muted";
  const content = (
    <div
      className={`absolute left-1 right-1 z-10 overflow-hidden rounded-md border px-2 py-1 text-left shadow-sm ${classes}`}
      style={{ top: Math.max(top, 0), height }}
    >
      <p className="truncate text-xs font-semibold">{item.title}</p>
      <p className="truncate text-[10px] opacity-80">{item.subtitle}</p>
      {item.statusLabel ? (
        <span
          className={`mt-1 inline-block rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${item.statusClass}`}
        >
          {item.statusLabel}
        </span>
      ) : null}
    </div>
  );
  return item.href ? <Link href={item.href}>{content}</Link> : content;
}

function parseLocalParts(iso: string): { hour: number; minute: number } {
  const d = new Date(iso);
  return { hour: d.getHours(), minute: d.getMinutes() };
}

function formatHour(hour: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 || 12;
  return `${display}${suffix}`;
}

function formatTime(hour: number, minute: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 || 12;
  return `${display}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function minutesToLabel(totalMinutes: number): string {
  return formatTime(Math.floor(totalMinutes / 60), totalMinutes % 60).replace(
    ":00 ",
    " ",
  );
}

function formatDateTimeRange(startISO: string, endISO: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${fmt.format(new Date(startISO))}-${fmt.format(new Date(endISO))}`;
}

function toDateTimeLocal(date: string, hour: number, minute: number): string {
  const normalizedHour = Math.min(Math.max(hour, 0), 23);
  return `${date}T${String(normalizedHour).padStart(2, "0")}:${String(
    minute,
  ).padStart(2, "0")}`;
}
