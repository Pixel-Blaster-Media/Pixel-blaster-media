"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { calendarWeekStart, shiftCalendarDate } from "@/lib/booking/calendar-week-range";
import type { CalendarItem, DayColumn } from "./CalendarWeekView";

type Week = { weekStart: string; days: DayColumn[]; items: CalendarItem[]; state: "loading" | "ready" | "error"; googleLoadFailed?: boolean };
const MAX_WEEKS = 7;

export function useContinuousCalendar({ initialDays, initialItems, search, scrollerRef }: {
  initialDays: DayColumn[];
  initialItems: CalendarItem[];
  search: string;
  scrollerRef: RefObject<HTMLDivElement | null>;
}) {
  const initialWeek = initialDays[0]?.dateInput ?? "";
  const placeholder = useCallback((weekStart: string): Week => ({
    weekStart, items: [], state: "loading",
    days: initialDays.map((day, i) => {
      const key = shiftCalendarDate(weekStart, i);
      const date = new Date(`${key}T12:00:00Z`);
      return { ...day, key, dateInput: key, enabled: false, label: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(date) };
    }),
  }), [initialDays]);
  const seed = useCallback((weekStart: string): Week[] => [-7, 0, 7].map(offset => {
    const key = shiftCalendarDate(weekStart, offset);
    return key === initialWeek ? { weekStart: key, days: initialDays, items: initialItems, state: "ready" } : placeholder(key);
  }), [initialDays, initialItems, initialWeek, placeholder]);
  const [weeks, setWeeks] = useState<Week[]>(() => seed(initialWeek));
  const [visibleWeek, setVisibleWeek] = useState(initialWeek);
  const weeksRef = useRef(weeks);
  weeksRef.current = weeks;
  const requests = useRef(new Map<string, AbortController>());
  const focusDate = useRef<string | null>(initialWeek);
  const anchor = useRef<{ date: string; left: number; top: number } | null>(null);
  const frame = useRef<number | null>(null);
  const source = useRef({ initialDays, initialItems, search, initialWeek });

  const captureAnchor = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || anchor.current || focusDate.current) return;
    const left = scroller.getBoundingClientRect().left;
    const node = [...scroller.querySelectorAll<HTMLElement>("[data-calendar-day-header]")].find(el => el.getBoundingClientRect().right > left + 65);
    if (node) anchor.current = { date: node.dataset.calendarDayHeader!, left: node.getBoundingClientRect().left - left, top: scroller.scrollTop };
  }, [scrollerRef]);

  const load = useCallback(async (key: string, retry = false) => {
    if (requests.current.has(key)) return;
    const existing = weeksRef.current.find(week => week.weekStart === key);
    if (!retry && existing && existing.state !== "loading") return;
    const controller = new AbortController();
    requests.current.set(key, controller);
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    if (retry) { captureAnchor(); setWeeks(current => current.map(week => week.weekStart === key ? { ...week, state: "loading" } : week)); }
    try {
      const query = new URLSearchParams({ week: key, q: search });
      const response = await fetch(`/api/admin/calendar/week?${query}`, { signal: controller.signal, cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("week_unavailable");
      const data = await response.json() as { weekStart: string; days: DayColumn[]; items: CalendarItem[]; googleLoadFailed?: boolean };
      if (data.weekStart !== key || data.days.length !== 7 || data.days.some((day, i) => day.dateInput !== shiftCalendarDate(key, i))) throw new Error("invalid_week");
      if (requests.current.get(key) !== controller) return;
      captureAnchor();
      setWeeks(current => current.map(week => week.weekStart === key ? { ...data, state: "ready" } : week));
    } catch {
      if (requests.current.get(key) !== controller) return;
      captureAnchor();
      setWeeks(current => current.map(week => week.weekStart === key ? { ...week, state: "error" } : week));
    } finally {
      window.clearTimeout(timeout);
      if (requests.current.get(key) === controller) requests.current.delete(key);
    }
  }, [captureAnchor, search]);

  useEffect(() => {
    const changed = source.current.initialItems !== initialItems || source.current.initialDays !== initialDays || source.current.search !== search;
    const navigated = source.current.search !== search || source.current.initialWeek !== initialWeek;
    source.current = { initialDays, initialItems, search, initialWeek };
    if (changed) {
      for (const controller of requests.current.values()) controller.abort();
      requests.current.clear();
      if (navigated) {
        focusDate.current = initialWeek; anchor.current = null;
        setVisibleWeek(initialWeek); setWeeks(seed(initialWeek)); return;
      }
      captureAnchor();
      // A mutation refresh invalidates the other windows too: a moved booking
      // must not survive as a stale duplicate in an already visited week.
      setWeeks(current => current.map(week => week.weekStart === initialWeek
        ? { weekStart: initialWeek, days: initialDays, items: initialItems, state: "ready" }
        : placeholder(week.weekStart)));
    }
  }, [initialDays, initialItems, initialWeek, search, captureAnchor, placeholder, seed]);
  useEffect(() => {
    const retained = new Set(weeks.map(week => week.weekStart));
    for (const [date, controller] of requests.current) {
      if (!retained.has(date)) { controller.abort(); requests.current.delete(date); }
    }
    for (const week of weeks) if (week.state === "loading") void load(week.weekStart);
  }, [weeks, load]);
  useEffect(() => () => {
    for (const controller of requests.current.values()) controller.abort();
    requests.current.clear();
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const wheel = (event: WheelEvent) => {
      if (!event.shiftKey || event.ctrlKey || event.deltaX || !event.deltaY) return;
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientWidth : 1;
      scroller.scrollLeft += event.deltaY * scale;
    };
    scroller.addEventListener("wheel", wheel, { passive: false });
    return () => scroller.removeEventListener("wheel", wheel);
  });

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.clientWidth === 0) return;
    const date = focusDate.current ?? anchor.current?.date;
    if (!date) return;
    const node = scroller.querySelector<HTMLElement>(`[data-calendar-day-header="${date}"]`);
    if (!node) return;
    const offset = node.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
    scroller.scrollLeft += offset - (focusDate.current ? 64 : anchor.current!.left);
    if (anchor.current) scroller.scrollTop = anchor.current.top;
    focusDate.current = null; anchor.current = null;
  });

  const grow = useCallback((direction: -1 | 1) => {
    const current = weeksRef.current;
    const edge = direction < 0 ? current[0] : current.at(-1);
    if (!edge || edge.state !== "ready") return;
    const key = shiftCalendarDate(edge.weekStart, direction * 7);
    if (current.some(week => week.weekStart === key)) return;
    captureAnchor();
    setWeeks(old => {
      if (old.some(week => week.weekStart === key)) return old;
      const next = [...old, placeholder(key)].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
      const bounded = direction < 0 ? next.slice(0, MAX_WEEKS) : next.slice(-MAX_WEEKS);
      return bounded;
    });
  }, [captureAnchor, placeholder]);

  const onScroll = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const scroller = scrollerRef.current;
      if (!scroller || scroller.clientWidth === 0) return;
      const left = scroller.getBoundingClientRect().left;
      const node = [...scroller.querySelectorAll<HTMLElement>("[data-calendar-day-header]")].find(el => el.getBoundingClientRect().right > left + 65);
      if (node?.dataset.calendarDayHeader) setVisibleWeek(calendarWeekStart(node.dataset.calendarDayHeader));
      if (scroller.scrollLeft < 240) grow(-1);
      else if (scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft < 360) grow(1);
    });
  }, [grow, scrollerRef]);

  const jumpToDate = useCallback((date: string) => {
    const key = calendarWeekStart(date);
    focusDate.current = date; anchor.current = null;
    setVisibleWeek(key);
    if (!weeksRef.current.some(week => week.weekStart === key)) {
      for (const controller of requests.current.values()) controller.abort();
      requests.current.clear();
      setWeeks(seed(key));
    } else setWeeks(current => [...current]);
  }, [seed]);

  const days = useMemo(() => weeks.flatMap(week => week.days), [weeks]);
  const items = useMemo(() => {
    const unique = new Map<string, CalendarItem>();
    for (const week of weeks) for (const item of week.items) {
      // Calendar blocks may legitimately have one segment per local date.
      unique.set(`${item.kind}:${item.id}:${item.localDate}`, item);
    }
    return [...unique.values()];
  }, [weeks]);
  return { days, items, visibleWeek, jumpToDate, onScroll,
    activeDays: days.filter(day => calendarWeekStart(day.dateInput) === visibleWeek),
    stateForDay: (date: string) => weeks.find(week => week.weekStart === calendarWeekStart(date))?.state ?? "loading",
    failedWeeks: weeks.filter(week => week.state === "error"),
    loading: weeks.some(week => week.state === "loading"),
    googleLoadFailed: weeks.some(week => week.googleLoadFailed),
    retry: () => { for (const week of weeks) if (week.state === "error") void load(week.weekStart, true); },
  };
}
