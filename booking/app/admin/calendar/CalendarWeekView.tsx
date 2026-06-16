"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  CSSProperties,
  InputHTMLAttributes,
  PointerEvent,
  ReactNode,
} from "react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import AddressAutocomplete, {
  type PlaceParts,
} from "@/app/_components/AddressAutocomplete";
import { addCalendarBlock } from "@/app/admin/settings/availability/actions";
import {
  createAdminShoot,
  moveCalendarBlock,
  rescheduleCalendarShoot,
  searchRealtors,
  type RealtorSearchItem,
} from "./actions";

// Finer snap than the 30-min click-to-create grid: dragging is the
// precision tool, so it lands on 5-minute marks.
const DRAG_SNAP_MINUTES = 5;

interface CalendarItem {
  id: string;
  kind: "booking" | "block" | "google";
  title: string;
  subtitle: string;
  startsAt: string;
  endsAt: string;
  localDate: string;
  href?: string;
  statusLabel?: string;
  statusClass?: string;
}

interface PositionedCalendarItem extends CalendarItem {
  layout: CalendarItemLayout;
}

interface CalendarItemLayout {
  lane: number;
  laneCount: number;
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

interface CatalogItemOption {
  id: string;
  kind: "bundle" | "a_la_carte" | "addon";
  name: string;
  description: string;
  durationMinutes: number;
  priceCents: number;
  badge: string | null;
  requireHasVideo: boolean;
}

interface DragTarget {
  day: DayColumn;
  mode: "desktop" | "mobile";
  startMinutes: number;
  top: number;
  height: number;
}

interface CalendarDragState {
  item: CalendarItem;
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  offsetY: number;
  durationMinutes: number;
  hasMoved: boolean;
  target: DragTarget | null;
}

const START_HOUR = 7;
const END_HOUR = 20;
const SLOT_MINUTES = 30;
const HOUR_HEIGHT = 72;
const MOBILE_HOUR_HEIGHT = 56;

export default function CalendarWeekView({
  days,
  items,
  catalogItems,
}: {
  days: DayColumn[];
  items: CalendarItem[];
  catalogItems: CatalogItemOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<{
    day: DayColumn;
    hour: number;
    minute: number;
  } | null>(null);
  const [mode, setMode] = useState<"shoot" | "block">("shoot");
  const [error, setError] = useState<string | null>(null);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [realtorSearchResults, setRealtorSearchResults] = useState<
    RealtorSearchItem[]
  >([]);
  const [isRealtorSearchOpen, setIsRealtorSearchOpen] = useState(false);
  const [selectedRealtorId, setSelectedRealtorId] = useState<string | null>(
    null,
  );
  const [realtor, setRealtor] = useState({
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    brokerage: "",
  });
  const [property, setProperty] = useState({
    street_address: "",
    unit_number: "",
    city: "",
    province: "ON",
    postal_code: "",
    square_footage: "",
  });
  const [pending, startTransition] = useTransition();
  const [lookupPending, startLookupTransition] = useTransition();
  const [movePending, startMoveTransition] = useTransition();
  const [moveError, setMoveError] = useState<string | null>(null);
  const [dragState, setDragState] = useState<CalendarDragState | null>(null);
  const dragRef = useRef<CalendarDragState | null>(null);
  const suppressOpenUntilRef = useRef(0);
  const [mobileDayKey, setMobileDayKey] = useState(() => {
    const today = dateInputForLocalDate();
    if (days.some((day) => day.dateInput === today)) return today;
    return days.find((day) => day.enabled)?.dateInput ?? days[0]?.dateInput ?? "";
  });

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const key = item.localDate;
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [items]);
  const positionedItemsByDay = useMemo(
    () => buildPositionedItemsByDay(items),
    [items],
  );

  const gridHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
  const selectedSlot = selected
    ? toDateTimeLocal(selected.day.dateInput, selected.hour, selected.minute)
    : null;
  const selectedTimeOptions = selected
    ? buildTimeOptionsForDay(selected.day)
    : [];
  const mobileDay =
    days.find((day) => day.dateInput === mobileDayKey) ?? days[0] ?? null;
  const mobileDayItems = mobileDay
    ? positionedItemsByDay.get(mobileDay.dateInput) ?? []
    : [];
  const mobileTimelineStart = START_HOUR * 60;
  const mobileTimelineEnd = END_HOUR * 60;
  const mobileTimelineHeight =
    ((mobileTimelineEnd - mobileTimelineStart) / 60) * MOBILE_HOUR_HEIGHT;
  const mobileHourMarks = Array.from({
    length: END_HOUR - START_HOUR + 1,
  }).map((_, i) => mobileTimelineStart + i * 60);
  const mobileSlots = useMemo(() => {
    const slots: { hour: number; minute: number }[] = [];
    for (
      let minutes = mobileTimelineStart;
      minutes < mobileTimelineEnd;
      minutes += SLOT_MINUTES
    ) {
      slots.push({
        hour: Math.floor(minutes / 60),
        minute: minutes % 60,
      });
    }
    return slots;
  }, [mobileTimelineEnd, mobileTimelineStart]);
  useEffect(() => {
    const query = realtor.contact_name.trim();
    if (selectedRealtorId || query.length < 2) {
      setRealtorSearchResults([]);
      setIsRealtorSearchOpen(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLookupMessage("Searching saved realtors...");
      startLookupTransition(async () => {
        try {
          const result = await searchRealtors(query);
          if (cancelled) return;
          if (!result.ok) {
            setRealtorSearchResults([]);
            setIsRealtorSearchOpen(false);
            setLookupMessage(
              result.error ?? "Could not search realtors. Enter details manually.",
            );
            return;
          }
          setRealtorSearchResults(result.realtors);
          setIsRealtorSearchOpen(result.realtors.length > 0);
          setLookupMessage(
            result.realtors.length === 0
              ? "No saved realtor found. Enter the email below."
              : null,
          );
        } catch {
          if (cancelled) return;
          setRealtorSearchResults([]);
          setIsRealtorSearchOpen(false);
          setLookupMessage("Could not search realtors. Enter details manually.");
        }
      });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [realtor.contact_name, selectedRealtorId]);

  const selectRealtor = (result: RealtorSearchItem) => {
    setSelectedRealtorId(result.id);
    setRealtor({
      contact_name: result.fullName || result.email,
      contact_email: result.email,
      contact_phone: result.phone,
      brokerage: result.brokerage,
    });
    setRealtorSearchResults([]);
    setIsRealtorSearchOpen(false);
    setLookupMessage("Realtor selected.");
  };

  const setActiveDrag = (next: CalendarDragState | null) => {
    dragRef.current = next;
    setDragState(next);
  };

  const dragTargetFromPoint = (
    clientX: number,
    clientY: number,
    offsetY: number,
    durationMinutes: number,
  ): DragTarget | null => {
    const element = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-calendar-drop-day]");
    const dateInput = element?.dataset.calendarDropDay;
    if (!element || !dateInput) return null;
    const day = days.find((candidate) => candidate.dateInput === dateInput);
    if (!day) return null;

    const mode =
      element.dataset.calendarDropMode === "mobile" ? "mobile" : "desktop";
    const rangeStart =
      mode === "mobile" ? mobileTimelineStart : START_HOUR * 60;
    const rangeEnd = mode === "mobile" ? mobileTimelineEnd : END_HOUR * 60;
    const hourHeight = mode === "mobile" ? MOBILE_HOUR_HEIGHT : HOUR_HEIGHT;
    const rect = element.getBoundingClientRect();
    const rawTop = clientY - rect.top - offsetY;
    const rawMinutes = (rawTop / hourHeight) * 60;
    const snappedMinutes =
      Math.round(rawMinutes / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES;
    const maxStart = Math.max(rangeStart, rangeEnd - durationMinutes);
    const startMinutes = Math.min(
      Math.max(rangeStart + snappedMinutes, rangeStart),
      maxStart,
    );

    return {
      day,
      mode,
      startMinutes,
      top: ((startMinutes - rangeStart) / 60) * hourHeight,
      height: Math.max((durationMinutes / 60) * hourHeight, mode === "mobile" ? 44 : 32),
    };
  };

  const beginBookingDrag = (
    event: PointerEvent<HTMLElement>,
    item: CalendarItem,
  ) => {
    if (movePending) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const durationMinutes = Math.max(
      localMinutesFromIso(item.endsAt) - localMinutesFromIso(item.startsAt),
      SLOT_MINUTES,
    );
    event.currentTarget.setPointerCapture(event.pointerId);
    const next: CalendarDragState = {
      item,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      offsetY: event.clientY - rect.top,
      durationMinutes,
      hasMoved: false,
      target: dragTargetFromPoint(
        event.clientX,
        event.clientY,
        event.clientY - rect.top,
        durationMinutes,
      ),
    };
    setActiveDrag(next);
  };

  const updateBookingDrag = (event: PointerEvent<HTMLElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - current.startX,
      event.clientY - current.startY,
    );
    const next: CalendarDragState = {
      ...current,
      currentX: event.clientX,
      currentY: event.clientY,
      hasMoved: current.hasMoved || distance > 5,
      target: dragTargetFromPoint(
        event.clientX,
        event.clientY,
        current.offsetY,
        current.durationMinutes,
      ),
    };
    if (next.hasMoved) event.preventDefault();
    setActiveDrag(next);
  };

  const finishBookingDrag = (event: PointerEvent<HTMLElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setActiveDrag(null);
    if (!current.hasMoved || !current.target) return;

    event.preventDefault();
    suppressOpenUntilRef.current = Date.now() + 500;
    const bookingId = current.item.id;
    const day = current.target.day;
    const startMinutes = current.target.startMinutes;
    setMoveError(null);
    startMoveTransition(async () => {
      const result =
        current.item.kind === "block"
          ? await moveCalendarBlock(bookingId, day.dateInput, startMinutes)
          : await rescheduleCalendarShoot(
              bookingId,
              day.dateInput,
              startMinutes,
            );
      if (!result.ok) {
        setMoveError(result.error ?? "Could not move that calendar item.");
        return;
      }
      router.refresh();
    });
  };

  const openCalendarItem = (item: CalendarItem) => {
    if (!item.href || Date.now() < suppressOpenUntilRef.current) return;
    router.push(item.href);
  };

  return (
    <div className="max-w-full space-y-3 overflow-hidden md:space-y-4">
      <div className="hidden text-realtor-muted md:flex md:flex-wrap md:items-center md:gap-3 md:text-xs">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-[#fffdf8] ring-1 ring-[#d8cab9]" />
          Working hours
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-[#d7d1c4] ring-1 ring-[#bdb4a5]" />
          Blocked/off hours
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-[#dce9dc] ring-1 ring-[#89a68f]" />
          Shoot
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-[#d9edf8] ring-1 ring-[#5aa6c8]" />
          Google Calendar
        </span>
        <span className="text-[11px] text-[#6f7a70]">
          Tip: drag a shoot or blocked time to move it.
        </span>
        {movePending ? (
          <span className="font-semibold text-[#3f7356]">
            Moving calendar item...
          </span>
        ) : null}
        {moveError ? (
          <span role="alert" className="font-semibold text-red-700">
            {moveError}
          </span>
        ) : null}
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-[#d8cab9]/70 bg-[#fffdf8]/80 shadow-lg shadow-black/10 md:block">
        <div className="grid min-w-[980px] grid-cols-[64px_repeat(7,minmax(120px,1fr))]">
          <div className="border-b border-[#d8cab9]/70 bg-[#fffdf8] px-2 py-3" />
          {days.map((day) => (
            <div
              key={day.key}
              className="border-b border-l border-[#d8cab9]/70 bg-[#fffdf8] px-3 py-3"
            >
              <p className="text-xs uppercase tracking-wider text-[#6f7a70]">
                {day.shortLabel}
              </p>
              <p className="text-xs font-semibold text-[#23332b]">{day.label}</p>
            </div>
          ))}

          <div className="relative bg-[#fffdf8]" style={{ height: gridHeight }}>
            {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => (
              <div
                key={i}
                className="absolute right-2 text-[10px] text-[#6f7a70]"
                style={{ top: i * HOUR_HEIGHT - 6 }}
              >
                {formatHour(START_HOUR + i)}
              </div>
            ))}
          </div>

          {days.map((day) => (
            <div
              key={day.key}
              data-calendar-drop-day={day.dateInput}
              data-calendar-drop-mode="desktop"
              className="relative border-l border-[#d8cab9]/65 bg-[#d7d1c4]/55"
              style={{ height: gridHeight }}
            >
              {day.enabled ? (
                <div
                  className="absolute left-0 right-0 bg-[#fffdf8] ring-1 ring-inset ring-[#d8cab9]/80"
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
                <div className="absolute inset-0 bg-[#d0cabd]/70" />
              )}
              {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => (
                <div
                  key={`hour-line-${i}`}
                  className="pointer-events-none absolute left-0 right-0 z-[1] border-t border-[#ded6c8]/80"
                  style={{ top: i * HOUR_HEIGHT }}
                />
              ))}
              {Array.from({ length: (END_HOUR - START_HOUR) * 2 }).map(
                (_, slot) => {
                  const minutes = slot * SLOT_MINUTES;
                  const absoluteMinutes = START_HOUR * 60 + minutes;
                  const hour = START_HOUR + Math.floor(minutes / 60);
                  const minute = minutes % 60;
                  const slotIsWorking = isWithinWorkingHours(
                    day,
                    absoluteMinutes,
                  );
                  return (
                    <button
                      key={slot}
                      type="button"
                      disabled={!slotIsWorking}
                      aria-label={`Select ${day.label} ${formatTime(
                        hour,
                        minute,
                      )}`}
                      onClick={() => {
                        setError(null);
                        setLookupMessage(null);
                        setMode("shoot");
                        setSelected({ day, hour, minute });
                      }}
                      className={
                        "absolute left-0 right-0 z-[2] border-t border-[#ede6d9]/60 transition " +
                        (slotIsWorking
                          ? "hover:bg-[#3f7356]/10"
                          : "cursor-not-allowed")
                      }
                      style={{
                        top: (minutes / 60) * HOUR_HEIGHT,
                        height: (SLOT_MINUTES / 60) * HOUR_HEIGHT,
                      }}
                    />
                  );
                },
              )}

              {(positionedItemsByDay.get(day.dateInput) ?? []).map((item) => (
                <CalendarEvent
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  isDragging={dragState?.item.id === item.id}
                  onOpen={openCalendarItem}
                  onPointerDown={beginBookingDrag}
                  onPointerMove={updateBookingDrag}
                  onPointerUp={finishBookingDrag}
                />
              ))}

              {dragState?.hasMoved &&
              dragState.target?.mode === "desktop" &&
              dragState.target.day.dateInput === day.dateInput ? (
                <CalendarDragPreview
                  item={dragState.item}
                  top={dragState.target.top}
                  height={dragState.target.height}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-full space-y-2 overflow-hidden md:hidden">
        <div className="grid max-w-full grid-cols-7 gap-1">
          {days.map((day) => {
            const isSelected = day.dateInput === mobileDay?.dateInput;
            const dayItems = itemsByDay.get(day.dateInput) ?? [];
            return (
              <button
                key={day.key}
                type="button"
                onClick={() => setMobileDayKey(day.dateInput)}
                className={`min-w-0 rounded-lg border px-1 py-1 text-center shadow-sm transition ${
                  isSelected
                    ? "border-[#3f7356] bg-[#3f7356] text-white"
                    : "border-[#d8cab9] bg-[#fffdf8] text-[#23332b]"
                }`}
              >
                <span
                  className={`block text-[8px] uppercase tracking-wide ${
                    isSelected ? "text-white/75" : "text-[#6f7a70]"
                  }`}
                >
                  {day.shortLabel.slice(0, 3)}
                </span>
                <span className="mt-0.5 block text-[11px] font-semibold leading-none">
                  {day.label.split(" ").at(-1)}
                </span>
                <span
                  aria-label={
                    dayItems.length > 0
                      ? `${dayItems.length} item${dayItems.length === 1 ? "" : "s"}`
                      : day.enabled
                        ? "Open"
                        : "Closed"
                  }
                  className={`mx-auto mt-1 block h-1.5 w-1.5 rounded-full ${
                    dayItems.length > 0
                      ? isSelected
                        ? "bg-white/85"
                        : "bg-[#3f7356]"
                      : day.enabled
                        ? isSelected
                          ? "bg-white/45"
                          : "bg-[#9fb79f]"
                        : isSelected
                          ? "bg-white/25"
                          : "bg-[#d7d1c4]"
                  }`}
                />
              </button>
            );
          })}
        </div>

        <div className="grid max-w-full grid-cols-4 gap-1 rounded-xl border border-[#d8cab9]/70 bg-[#fffdf8]/75 p-1.5 text-[9px] text-[#6f7a70]">
          <span className="inline-flex min-w-0 items-center justify-center gap-1">
            <span className="h-2 w-2 shrink-0 rounded-sm bg-[#fffdf8] ring-1 ring-[#d8cab9]" />
            <span className="truncate">Working</span>
          </span>
          <span className="inline-flex min-w-0 items-center justify-center gap-1">
            <span className="h-2 w-2 shrink-0 rounded-sm bg-[#d7d1c4] ring-1 ring-[#bdb4a5]" />
            <span className="truncate">Blocked</span>
          </span>
          <span className="inline-flex min-w-0 items-center justify-center gap-1">
            <span className="h-2 w-2 shrink-0 rounded-sm bg-[#dce9dc] ring-1 ring-[#89a68f]" />
            <span className="truncate">Shoot</span>
          </span>
          <span className="inline-flex min-w-0 items-center justify-center gap-1">
            <span className="h-2 w-2 shrink-0 rounded-sm bg-[#d9edf8] ring-1 ring-[#5aa6c8]" />
            <span className="truncate">Google</span>
          </span>
        </div>

        {mobileDay ? (
          <section className="max-w-full overflow-hidden rounded-xl border border-[#d8cab9]/80 bg-[#fffdf8] p-2.5 shadow-lg shadow-black/10">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[#6f7a70]">
                  Day view
                </p>
                <h2 className="mt-0.5 text-sm font-semibold text-[#23332b]">
                  {mobileDay.shortLabel} {mobileDay.label}
                </h2>
              </div>
              <span className="shrink-0 rounded-full border border-[#d8cab9] bg-[#f7f4ed] px-2 py-1 text-[10px] text-[#6f7a70]">
                {mobileDay.enabled
                  ? `${minutesToLabel(
                      mobileDay.workStartMinutes,
                    )}-${minutesToLabel(mobileDay.workEndMinutes)}`
                  : "Closed"}
              </span>
            </div>

            <div className="mt-3 border-t border-[#d8cab9]/70 pt-3">
              <p className="text-xs font-semibold text-[#23332b]">
                Daily calendar
              </p>
              <p className="mt-0.5 text-[10px] text-[#6f7a70]">
                Tap any open slot to add a shoot or block time.
              </p>
              <div
                data-calendar-drop-day={mobileDay.dateInput}
                data-calendar-drop-mode="mobile"
                className="relative mt-3 overflow-hidden rounded-r-2xl border border-[#d8cab9] bg-[#d7d1c4]/55"
                style={{ height: mobileTimelineHeight }}
              >
                {mobileDay.enabled ? (
                  <div
                    className="absolute left-10 right-0 bg-[#fffdf8] ring-1 ring-inset ring-[#d8cab9]/80"
                    style={{
                      top:
                        ((mobileDay.workStartMinutes - mobileTimelineStart) / 60) *
                        MOBILE_HOUR_HEIGHT,
                      height:
                        ((mobileDay.workEndMinutes - mobileDay.workStartMinutes) /
                          60) *
                        MOBILE_HOUR_HEIGHT,
                    }}
                  />
                ) : (
                  <div className="absolute inset-y-0 left-10 right-0 bg-[#d0cabd]/70" />
                )}

                {mobileHourMarks.map((minutes) => (
                  <div
                    key={`mobile-hour-${minutes}`}
                    className="pointer-events-none absolute left-0 right-0 z-[1] border-t border-[#ded6c8]/80"
                    style={{
                      top: ((minutes - mobileTimelineStart) / 60) * MOBILE_HOUR_HEIGHT,
                    }}
                  >
                    <span className="absolute left-1 top-0.5 text-[8px] font-semibold text-[#6f7a70]">
                      {minutesToLabel(minutes)}
                    </span>
                  </div>
                ))}

                {mobileSlots.map((slot) => {
                  const minutes = slot.hour * 60 + slot.minute;
                  const slotIsWorking = isWithinWorkingHours(
                    mobileDay,
                    minutes,
                  );
                  return (
                    <button
                      key={`${slot.hour}:${slot.minute}`}
                      type="button"
                      disabled={!slotIsWorking}
                      aria-label={`Add something at ${formatTime(
                        slot.hour,
                        slot.minute,
                      )}`}
                      onClick={() => {
                        setError(null);
                        setLookupMessage(null);
                        setMode("shoot");
                        setSelected({
                          day: mobileDay,
                          hour: slot.hour,
                          minute: slot.minute,
                        });
                      }}
                      className={
                        "absolute left-10 right-0 z-[2] border-t border-[#ede6d9]/60 transition " +
                        (slotIsWorking
                          ? "hover:bg-[#3f7356]/10 active:bg-[#3f7356]/10"
                          : "cursor-not-allowed")
                      }
                      style={{
                        top:
                          ((minutes - mobileTimelineStart) / 60) * MOBILE_HOUR_HEIGHT,
                        height: (SLOT_MINUTES / 60) * MOBILE_HOUR_HEIGHT,
                      }}
                    />
                  );
                })}

                {mobileDayItems.length === 0 ? (
                  <div className="absolute left-12 right-2 top-2 z-[3] rounded-lg border border-dashed border-[#d8cab9] bg-[#f7f4ed]/85 px-2 py-1.5 text-[10px] text-[#6f7a70]">
                    Nothing booked yet.
                  </div>
                ) : null}

                {mobileDayItems.map((item) => (
                  <MobileTimelineEvent
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    rangeStart={mobileTimelineStart}
                    rangeEnd={mobileTimelineEnd}
                    isDragging={dragState?.item.id === item.id}
                    onOpen={openCalendarItem}
                    onPointerDown={beginBookingDrag}
                    onPointerMove={updateBookingDrag}
                    onPointerUp={finishBookingDrag}
                  />
                ))}

                {dragState?.hasMoved &&
                dragState.target?.mode === "mobile" &&
                dragState.target.day.dateInput === mobileDay.dateInput ? (
                  <CalendarDragPreview
                    item={dragState.item}
                    top={dragState.target.top}
                    height={dragState.target.height}
                    mobile
                  />
                ) : null}
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {selected ? (
        <div className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 max-h-[85dvh] overflow-y-auto rounded-2xl border border-realtor-primary/30 bg-realtor-surface/95 p-4 shadow-2xl shadow-realtor-text/15 backdrop-blur-xl md:left-auto md:w-[560px]">
          <div className="relative pr-16">
            <div>
              <p className="text-sm font-semibold text-realtor-text">
                {selected.day.label} at{" "}
                {formatTime(selected.hour, selected.minute)}
              </p>
              <p className="mt-1 text-xs text-realtor-muted">
                Add a confirmed shoot here, or block the time off privately.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="tap-target absolute right-0 top-0 rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs font-semibold text-realtor-text shadow-sm transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
            >
              Close
            </button>
          </div>

          <label className="mt-4 block overflow-hidden rounded-2xl border border-realtor-primary/15 bg-white/65 p-3">
            <span className="text-xs font-semibold text-realtor-muted">
              Adjust time manually
            </span>
            <select
              value={`${String(selected.hour).padStart(2, "0")}:${String(
                selected.minute,
              ).padStart(2, "0")}`}
              onChange={(event) => {
                const [hour, minute] = event.currentTarget.value
                  .split(":")
                  .map(Number);
                if (Number.isFinite(hour) && Number.isFinite(minute)) {
                  setSelected((current) =>
                    current ? { ...current, hour, minute } : current,
                  );
                }
              }}
              className="mt-1 box-border block w-full min-w-0 max-w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-left text-sm text-realtor-text outline-none focus:border-realtor-primary/45"
            >
              {selectedTimeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4 inline-flex rounded-full border border-realtor-primary/15 bg-realtor-surface p-1 text-xs">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("shoot");
              }}
              className={`tap-target rounded-full px-3 py-1.5 ${
                mode === "shoot"
                  ? "bg-realtor-primary text-white"
                  : "text-realtor-muted hover:text-realtor-primary"
              }`}
            >
              Add shoot
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("block");
              }}
              className={`tap-target rounded-full px-3 py-1.5 ${
                mode === "block"
                  ? "bg-realtor-primary text-white"
                  : "text-realtor-muted hover:text-realtor-primary"
              }`}
            >
              Block time
            </button>
          </div>

          {mode === "shoot" ? (
            <form
              className="mt-4 space-y-4"
              action={(formData) => {
                setError(null);
                startTransition(async () => {
                  const result = await createAdminShoot(formData);
                  if (!result.ok || !result.bookingId) {
                    setError(result.error ?? "Could not add shoot.");
                    return;
                  }
                  router.push(`/admin/bookings/${result.bookingId}`);
                });
              }}
            >
              <input
                type="hidden"
                name="scheduled_at"
                value={selectedSlot ?? ""}
              />

              <FormSection
                step="1"
                title="Package"
                detail="Pick what they booked first. Add-ons can stay empty."
              >
                <CatalogPicker items={catalogItems} />
              </FormSection>

              <FormSection
                step="2"
                title="Realtor"
                detail="Start with the name. Pick a saved realtor to fill the rest."
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="relative block">
                    <span className="text-xs text-realtor-muted">Realtor name</span>
                    <div className="mt-1">
                      <input
                        name="contact_name"
                        type="text"
                        required
                        autoComplete="off"
                        value={realtor.contact_name}
                        onFocus={() => {
                          if (realtorSearchResults.length > 0) {
                            setIsRealtorSearchOpen(true);
                          }
                        }}
                        onBlur={() => {
                          window.setTimeout(
                            () => setIsRealtorSearchOpen(false),
                            120,
                          );
                        }}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setLookupMessage(null);
                          setSelectedRealtorId(null);
                          setRealtor((draft) => ({
                            ...draft,
                            contact_name: value,
                            contact_email: "",
                            contact_phone: "",
                            brokerage: "",
                          }));
                        }}
                        className="w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text"
                      />
                      {isRealtorSearchOpen && realtorSearchResults.length > 0 ? (
                        <ul className="absolute left-0 right-0 z-30 mt-1 max-h-60 overflow-auto rounded-xl border border-realtor-primary/15 bg-realtor-surface shadow-2xl shadow-realtor-text/15">
                          {realtorSearchResults.map((result) => (
                            <li key={result.id}>
                              <button
                                type="button"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  selectRealtor(result);
                                }}
                                className="block w-full px-3 py-2 text-left text-sm text-realtor-text transition hover:bg-realtor-primary/10"
                              >
                                <span className="block font-semibold">
                                  {result.fullName || result.email}
                                </span>
                                <span className="block truncate text-xs text-realtor-muted">
                                  {[result.email, result.brokerage]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </label>
                  <TextField
                    label="Email"
                    name="contact_email"
                    type="email"
                    required
                    autoComplete="email"
                    value={realtor.contact_email}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setRealtor((draft) => ({
                        ...draft,
                        contact_email: value,
                      }));
                    }}
                  />
                  <TextField
                    label="Phone"
                    name="contact_phone"
                    type="tel"
                    autoComplete="tel"
                    value={realtor.contact_phone}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setRealtor((draft) => ({
                        ...draft,
                        contact_phone: value,
                      }));
                    }}
                  />
                  <TextField
                    label="Brokerage"
                    name="brokerage"
                    value={realtor.brokerage}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setRealtor((draft) => ({
                        ...draft,
                        brokerage: value,
                      }));
                    }}
                  />
                </div>
                {lookupMessage ? (
                  <p className="text-xs text-realtor-primary">
                    {lookupPending ? "Checking realtor..." : lookupMessage}
                  </p>
                ) : null}
              </FormSection>

              <FormSection
                step="3"
                title="Property"
                detail="Start typing the address and pick a suggestion when one matches."
              >
                <AddressAutocomplete
                  name="street_address"
                  label="Property address"
                  required
                  defaultValue={property.street_address}
                  onChange={(value) =>
                    setProperty((draft) => ({
                      ...draft,
                      street_address: value,
                    }))
                  }
                  onPlace={(parts: PlaceParts) => {
                    setProperty((draft) => ({
                      ...draft,
                      street_address: parts.street_address,
                      unit_number: parts.unit_number || draft.unit_number,
                      city: parts.city,
                      province: parts.province || draft.province,
                      postal_code: parts.postal_code,
                    }));
                  }}
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <TextField
                    label="Unit"
                    name="unit_number"
                    value={property.unit_number}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setProperty((draft) => ({
                        ...draft,
                        unit_number: value,
                      }));
                    }}
                  />
                  <TextField
                    label="City"
                    name="city"
                    value={property.city}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setProperty((draft) => ({
                        ...draft,
                        city: value,
                      }));
                    }}
                  />
                  <TextField
                    label="Province/state"
                    name="province"
                    value={property.province}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setProperty((draft) => ({
                        ...draft,
                        province: value,
                      }));
                    }}
                  />
                  <TextField
                    label="Postal code"
                    name="postal_code"
                    value={property.postal_code}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setProperty((draft) => ({
                        ...draft,
                        postal_code: value,
                      }));
                    }}
                  />
                  <TextField
                    label="Square feet"
                    name="square_footage"
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={property.square_footage}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setProperty((draft) => ({
                        ...draft,
                        square_footage: value,
                      }));
                    }}
                  />
                </div>
              </FormSection>

              <label className="block">
                <span className="text-xs text-realtor-muted">Notes</span>
                <textarea
                  name="notes"
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text"
                />
              </label>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-realtor-primary/90 disabled:opacity-60"
                >
                  {pending ? "Adding..." : "Add confirmed shoot"}
                </button>
                {error ? (
                  <p className="text-sm text-red-700" role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
            </form>
          ) : (
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
              <span className="text-xs text-realtor-muted">Ends</span>
              <input
                type="datetime-local"
                name="ends_at"
                defaultValue={toDateTimeLocal(
                  selected.day.dateInput,
                  selected.hour + 1,
                  selected.minute,
                )}
                required
                className="mt-1 w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text"
              />
            </label>
            <label className="block">
              <span className="text-xs text-realtor-muted">Private label</span>
              <input
                type="text"
                name="label"
                defaultValue="Busy"
                className="mt-1 w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text"
              />
            </label>
            <button
              type="submit"
              disabled={pending}
              className="self-end rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-realtor-primary/90 disabled:opacity-60"
            >
              {pending ? "Adding..." : "Add block"}
            </button>
            {error ? (
              <p className="md:col-span-3 text-sm text-red-700" role="alert">
                {error}
              </p>
            ) : null}
          </form>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TextField({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="text-xs text-realtor-muted">{label}</span>
      <input
        {...props}
        className="mt-1 w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text"
      />
    </label>
  );
}

function FormSection({
  step,
  title,
  detail,
  children,
}: {
  step: string;
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-realtor-primary/15 pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-realtor-primary/40 bg-realtor-primary/10 text-xs font-semibold text-realtor-primary">
          {step}
        </span>
        <div>
          <h2 className="text-sm font-semibold text-realtor-text">{title}</h2>
          <p className="text-xs text-realtor-muted">{detail}</p>
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function CatalogPicker({ items }: { items: CatalogItemOption[] }) {
  const groups: { title: string; kinds: CatalogItemOption["kind"][] }[] = [
    { title: "Packages", kinds: ["bundle"] },
    { title: "A-la-carte", kinds: ["a_la_carte"] },
    { title: "Add-ons", kinds: ["addon"] },
  ];

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const groupItems = items.filter((item) => group.kinds.includes(item.kind));
        if (groupItems.length === 0) return null;
        return (
          <fieldset key={group.title}>
            <legend className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
              {group.title}
            </legend>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {groupItems.map((item) => {
                const inputId = `catalog-item-${item.id}`;
                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface p-3 text-sm text-realtor-text transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
                  >
                    <div className="flex gap-3">
                      <input
                        id={inputId}
                        type="checkbox"
                        name="catalog_item_id"
                        value={item.id}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-realtor-primary/25 bg-realtor-surface"
                      />
                      <label htmlFor={inputId} className="min-w-0 flex-1 cursor-pointer">
                        <span className="flex flex-wrap items-center gap-2 font-semibold">
                          {item.name}
                          {item.badge ? (
                            <span className="rounded border border-realtor-primary/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-realtor-primary">
                              {item.badge}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block text-xs text-realtor-muted">
                          {formatPrice(item.priceCents)} ·{" "}
                          {formatDuration(item.durationMinutes)}
                          {item.requireHasVideo ? " · needs video" : ""}
                        </span>
                      </label>
                    </div>
                    {item.description ? (
                      <CatalogDescription description={item.description} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

function CatalogDescription({ description }: { description: string }) {
  const lines = description
    .split(/\s+-\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const preview = lines[0] ?? description;
  const detailLines = lines.length > 1 ? lines : [description];

  return (
    <details className="group mt-3 rounded-xl border border-realtor-primary/15 bg-white/65 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-realtor-muted marker:hidden">
        <span className="line-clamp-1 min-w-0">{preview}</span>
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-realtor-primary group-open:hidden">
          Details
        </span>
        <span className="hidden shrink-0 text-[10px] uppercase tracking-wider text-realtor-primary group-open:inline">
          Hide
        </span>
      </summary>
      <ul className="mt-2 space-y-1.5 border-t border-realtor-primary/15 pt-2 text-xs leading-5 text-realtor-muted">
        {detailLines.map((line, index) => (
          <li key={`${line}-${index}`} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-realtor-primary/70" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function MobileTimelineEvent({
  item,
  rangeStart,
  rangeEnd,
  isDragging,
  onOpen,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  item: PositionedCalendarItem;
  rangeStart: number;
  rangeEnd: number;
  isDragging: boolean;
  onOpen: (item: CalendarItem) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>, item: CalendarItem) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
}) {
  const startMinutes = localMinutesFromIso(item.startsAt);
  const endMinutes = localMinutesFromIso(item.endsAt);
  const top =
    ((Math.max(startMinutes, rangeStart) - rangeStart) / 60) * MOBILE_HOUR_HEIGHT;
  const height = Math.max(
    ((Math.min(endMinutes, rangeEnd) - Math.max(startMinutes, rangeStart)) /
      60) *
      MOBILE_HOUR_HEIGHT,
    44,
  );
  const classes =
    item.kind === "booking"
      ? "border-[#8ba98f] bg-[#dce9dc] text-[#23332b] shadow-[#23332b]/10"
      : item.kind === "google"
        ? "border-[#5aa6c8]/60 bg-[#d9edf8] text-[#17465b]"
        : "border-[#a69d8d]/50 bg-[#d7d1c4] text-[#36423a]";
  const canMove = item.kind === "booking" || item.kind === "block";
  const content = (
    <div
      className={`absolute z-10 overflow-hidden rounded-xl border px-2.5 py-1.5 text-left shadow-sm ${classes}`}
      style={eventLayoutStyle({ top, height, layout: item.layout, mobile: true })}
    >
      <div className="flex h-full min-w-0 flex-col justify-between gap-1">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-wider opacity-70">
            {formatDateTimeRange(item.startsAt, item.endsAt)}
          </p>
          <p className="mt-0.5 line-clamp-2 break-words text-xs font-semibold leading-tight">
            {item.title}
          </p>
          <p className="mt-0.5 line-clamp-1 break-words text-[10px] leading-snug opacity-75">
            {item.subtitle}
          </p>
        </div>
        <span className="w-fit rounded-full border border-current/25 bg-white/40 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider">
          {item.statusLabel ??
            (item.kind === "block"
              ? "Blocked"
              : item.kind === "google"
                ? "Google"
                : "Shoot")}
        </span>
      </div>
    </div>
  );

  if (canMove) {
    return (
      <button
        type="button"
        aria-label={`Open or drag ${item.title}`}
        onClick={() => onOpen(item)}
        onPointerDown={(event) => onPointerDown(event, item)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`absolute left-12 right-1.5 z-10 block touch-none select-none overflow-hidden rounded-xl border px-2.5 py-1.5 text-left shadow-sm transition ${
          isDragging
            ? "scale-[0.98] opacity-35"
            : "cursor-grab active:cursor-grabbing"
        } ${classes}`}
        style={eventLayoutStyle({ top, height, layout: item.layout, mobile: true })}
      >
        <div className="flex h-full min-w-0 flex-col justify-between gap-1">
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-wider opacity-70">
              {formatDateTimeRange(item.startsAt, item.endsAt)}
            </p>
            <p className="mt-0.5 line-clamp-2 break-words text-xs font-semibold leading-tight">
              {item.title}
            </p>
            <p className="mt-0.5 line-clamp-1 break-words text-[10px] leading-snug opacity-75">
              {item.subtitle}
            </p>
          </div>
          <span className="w-fit rounded-full border border-current/25 bg-white/40 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider">
            {item.statusLabel ?? "Shoot"}
          </span>
        </div>
      </button>
    );
  }

  return item.href ? <Link href={item.href}>{content}</Link> : content;
}

function CalendarEvent({
  item,
  isDragging,
  onOpen,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  item: PositionedCalendarItem;
  isDragging: boolean;
  onOpen: (item: CalendarItem) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>, item: CalendarItem) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
}) {
  const start = parseLocalParts(item.startsAt);
  const end = parseLocalParts(item.endsAt);
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  const top = ((startMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
  const height = Math.max(((endMinutes - startMinutes) / 60) * HOUR_HEIGHT, 32);
  const canMove = item.kind === "booking" || item.kind === "block";
  const classes =
    item.kind === "booking"
      ? "border-[#8ba98f] bg-[#dce9dc] text-[#23332b] hover:bg-[#d2e1d2]"
      : item.kind === "google"
        ? "border-[#5aa6c8]/60 bg-[#d9edf8] text-[#17465b] hover:bg-[#cbe5f2]"
        : "border-[#a69d8d]/45 bg-[#c9c3b6]/80 text-[#36423a] hover:bg-[#beb7aa]";
  const content = (
    <div
      className={`absolute z-10 overflow-hidden rounded-xl border px-2 py-1 text-left shadow-sm transition ${classes} ${
        isDragging ? "opacity-60 ring-2 ring-[#3f7356]/45" : ""
      }`}
      style={eventLayoutStyle({
        top: Math.max(top, 0),
        height,
        layout: item.layout,
      })}
    >
      <div className="flex min-w-0 items-start justify-between gap-1.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">{item.title}</p>
          <p className="truncate text-[10px] opacity-80">{item.subtitle}</p>
        </div>
        {canMove ? (
          <span className="shrink-0 rounded border border-current/20 bg-white/35 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider opacity-70">
            Drag
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-1.5">
        {item.statusLabel ? (
          <span
            className={`inline-block rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${item.statusClass}`}
          >
            {item.statusLabel}
          </span>
        ) : null}
        {item.href ? (
          <Link
            href={item.href}
            draggable={false}
            onClick={(event) => event.stopPropagation()}
            className="rounded-full border border-current/20 bg-white/35 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider opacity-80 hover:opacity-100"
          >
            Open
          </Link>
        ) : null}
      </div>
    </div>
  );

  if (canMove) {
    return (
      <button
        type="button"
        aria-label={`Open or drag ${item.title}`}
        onClick={() => onOpen(item)}
        onPointerDown={(event) => onPointerDown(event, item)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`absolute z-10 block touch-none select-none overflow-hidden rounded-xl border px-2 py-1 text-left shadow-sm transition ${
          isDragging
            ? "scale-[0.98] opacity-35"
            : "cursor-grab hover:bg-[#d2e1d2] active:cursor-grabbing"
        } ${classes}`}
        style={eventLayoutStyle({
          top: Math.max(top, 0),
          height,
          layout: item.layout,
        })}
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
      </button>
    );
  }

  return item.href ? <Link href={item.href}>{content}</Link> : content;
}

function CalendarDragPreview({
  item,
  top,
  height,
  mobile = false,
}: {
  item: CalendarItem;
  top: number;
  height: number;
  mobile?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute z-30 overflow-hidden rounded-xl border-2 border-[#3f7356] bg-[#e8f1e8]/95 px-2.5 py-1.5 text-left text-[#23332b] shadow-xl shadow-[#23332b]/20 ring-2 ring-[#3f7356]/20 ${
        mobile ? "left-12 right-1.5" : "left-1 right-1"
      }`}
      style={{ top, height }}
    >
      <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-[#3f7356]">
        Move here
      </p>
      <p className="truncate text-xs font-semibold">{item.title}</p>
      <p className="truncate text-[10px] text-[#526258]">{item.subtitle}</p>
    </div>
  );
}

function buildPositionedItemsByDay(
  items: CalendarItem[],
): Map<string, PositionedCalendarItem[]> {
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    byDay.set(item.localDate, [...(byDay.get(item.localDate) ?? []), item]);
  }

  const result = new Map<string, PositionedCalendarItem[]>();
  for (const [day, dayItems] of byDay) {
    const sorted = [...dayItems].sort((a, b) => {
      const startDelta =
        localMinutesFromIso(a.startsAt) - localMinutesFromIso(b.startsAt);
      if (startDelta !== 0) return startDelta;
      return localMinutesFromIso(a.endsAt) - localMinutesFromIso(b.endsAt);
    });
    const positioned: PositionedCalendarItem[] = [];
    let cluster: CalendarItem[] = [];
    let clusterEnd = -1;

    const flushCluster = () => {
      if (cluster.length === 0) return;
      const lanes: number[] = [];
      const clusterPositioned: PositionedCalendarItem[] = [];

      for (const item of cluster) {
        const start = localMinutesFromIso(item.startsAt);
        const end = Math.max(localMinutesFromIso(item.endsAt), start + 1);
        let lane = lanes.findIndex((laneEnd) => laneEnd <= start);
        if (lane === -1) {
          lane = lanes.length;
          lanes.push(end);
        } else {
          lanes[lane] = end;
        }
        clusterPositioned.push({
          ...item,
          layout: { lane, laneCount: 1 },
        });
      }

      const laneCount = Math.max(lanes.length, 1);
      for (const item of clusterPositioned) {
        positioned.push({
          ...item,
          layout: { ...item.layout, laneCount },
        });
      }
      cluster = [];
      clusterEnd = -1;
    };

    for (const item of sorted) {
      const start = localMinutesFromIso(item.startsAt);
      const end = Math.max(localMinutesFromIso(item.endsAt), start + 1);
      if (cluster.length > 0 && start >= clusterEnd) {
        flushCluster();
      }
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, end);
    }
    flushCluster();

    result.set(day, positioned);
  }

  return result;
}

function eventLayoutStyle({
  top,
  height,
  layout,
  mobile = false,
}: {
  top: number;
  height: number;
  layout: CalendarItemLayout;
  mobile?: boolean;
}): CSSProperties {
  const laneCount = Math.max(layout.laneCount, 1);
  const lane = Math.min(Math.max(layout.lane, 0), laneCount - 1);
  if (mobile) {
    return {
      top,
      height,
      left: `calc(3rem + (${lane} * (100% - 3.375rem) / ${laneCount}) + 0.125rem)`,
      width: `calc((100% - 3.375rem) / ${laneCount} - 0.25rem)`,
    };
  }

  return {
    top,
    height,
    left: `calc((${lane} * 100%) / ${laneCount} + 0.25rem)`,
    width: `calc(100% / ${laneCount} - 0.5rem)`,
  };
}

function parseLocalParts(iso: string): { hour: number; minute: number } {
  const d = new Date(iso);
  return { hour: d.getHours(), minute: d.getMinutes() };
}

function localMinutesFromIso(iso: string): number {
  const parts = parseLocalParts(iso);
  return parts.hour * 60 + parts.minute;
}

function isWithinWorkingHours(day: DayColumn, minutes: number): boolean {
  return (
    day.enabled &&
    minutes >= day.workStartMinutes &&
    minutes < day.workEndMinutes
  );
}

function buildTimeOptionsForDay(
  day: DayColumn,
): { value: string; label: string }[] {
  const start = Math.max(day.workStartMinutes, START_HOUR * 60);
  const end = Math.min(day.workEndMinutes, END_HOUR * 60);
  const options: { value: string; label: string }[] = [];
  for (let minutes = start; minutes < end; minutes += SLOT_MINUTES) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    options.push({
      value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(
        2,
        "0",
      )}`,
      label: formatTime(hour, minute),
    });
  }
  return options;
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

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const extraMinutes = minutes % 60;
  return extraMinutes === 0
    ? `${hours} hr`
    : `${hours} hr ${extraMinutes} min`;
}

function toDateTimeLocal(date: string, hour: number, minute: number): string {
  const normalizedHour = Math.min(Math.max(hour, 0), 23);
  return `${date}T${String(normalizedHour).padStart(2, "0")}:${String(
    minute,
  ).padStart(2, "0")}`;
}

function dateInputForLocalDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}
