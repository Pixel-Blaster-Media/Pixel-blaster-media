"use client";

import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  CSSProperties,
  InputHTMLAttributes,
  PointerEvent,
  ReactNode,
  TouchEvent,
} from "react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import AddressAutocomplete, {
  type PlaceParts,
} from "@/app/_components/AddressAutocomplete";
import {
  addCalendarBlock,
  deleteCalendarBlock,
  updateCalendarBlock,
} from "@/app/admin/settings/availability/actions";
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
  syncWarning?: string;
  sourceColor?: string;
  bookingDetails?: {
    fullAddress: string;
    services: string[];
    addOns: string[];
    realtorName: string;
    realtorEmail: string;
    realtorPhone: string | null;
    brokerage: string | null;
    realtorNotes: string | null;
    clientNotes: string | null;
    internalNotes: string | null;
    propertyNotes: string | null;
    squareFootage: number | null;
    occupancy: string | null;
    includeBasement: boolean | null;
  };
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

interface TimeRangeDragState {
  day: DayColumn;
  pointerId: number;
  anchorMinutes: number;
  currentMinutes: number;
  startY: number;
  hasMoved: boolean;
}

interface CalendarNavigation {
  previousHref: string;
  todayHref: string;
  nextHref: string;
  search: string;
  weekValue: string | null;
  clearSearchHref: string | null;
}

type DesktopCalendarView = "day" | "week" | "agenda";
type MobileCalendarView = "day" | "agenda";

const START_HOUR = 6;
const END_HOUR = 22;
const SLOT_MINUTES = 30;
const HOUR_HEIGHT = 96;
const MOBILE_HOUR_HEIGHT = 84;
const DESKTOP_DAY_BASE_WIDTH = 128;
const DESKTOP_LANE_WIDTH = 120;
// TODO(SaaS): pass this from the organization once company timezones are
// configurable. Calendar positioning must never depend on the browser locale.
const CALENDAR_TIME_ZONE = "America/Toronto";
const calendarPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CALENDAR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export default function CalendarWeekView({
  days,
  items,
  catalogItems,
  navigation,
  calendarMenu,
}: {
  days: DayColumn[];
  items: CalendarItem[];
  catalogItems: CatalogItemOption[];
  navigation: CalendarNavigation;
  calendarMenu: ReactNode;
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
  const [timeRangeDrag, setTimeRangeDrag] =
    useState<TimeRangeDragState | null>(null);
  const [blockEndsAt, setBlockEndsAt] = useState("");
  const dragRef = useRef<CalendarDragState | null>(null);
  const timeRangeDragRef = useRef<TimeRangeDragState | null>(null);
  const suppressOpenUntilRef = useRef(0);
  const suppressSlotClickUntilRef = useRef(0);
  const desktopTimelineScrollRef = useRef<HTMLDivElement | null>(null);
  const mobileTimelineScrollRef = useRef<HTMLDivElement | null>(null);
  const mobileSwipeRef = useRef<{ x: number; y: number; time: number } | null>(
    null,
  );
  const [mobileDayKey, setMobileDayKey] = useState(() => {
    const today = dateInputForLocalDate();
    if (days.some((day) => day.dateInput === today)) return today;
    return days.find((day) => day.enabled)?.dateInput ?? days[0]?.dateInput ?? "";
  });
  const [desktopView, setDesktopView] =
    useState<DesktopCalendarView>("week");
  const [mobileView, setMobileView] = useState<MobileCalendarView>("day");
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<CalendarItem | null>(null);
  const [now, setNow] = useState<Date | null>(null);

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
  const mobileDay =
    days.find((day) => day.dateInput === mobileDayKey) ?? days[0] ?? null;
  const displayedDesktopDays = useMemo(
    () => (desktopView === "day" && mobileDay ? [mobileDay] : days),
    [days, desktopView, mobileDay],
  );
  const desktopDayWidths = useMemo(() => {
    const widths = new Map<string, number>();
    for (const day of displayedDesktopDays) {
      const maxLaneCount = Math.max(
        1,
        ...(positionedItemsByDay.get(day.dateInput) ?? []).map(
          (item) => item.layout.laneCount,
        ),
      );
      widths.set(
        day.dateInput,
        Math.max(DESKTOP_DAY_BASE_WIDTH, maxLaneCount * DESKTOP_LANE_WIDTH),
      );
    }
    return widths;
  }, [displayedDesktopDays, positionedItemsByDay]);
  const desktopGridTemplateColumns = `64px ${displayedDesktopDays
    .map(
      (day) =>
        `minmax(${desktopDayWidths.get(day.dateInput) ?? DESKTOP_DAY_BASE_WIDTH}px, 1fr)`,
    )
    .join(" ")}`;
  const desktopGridMinWidth =
    64 +
    displayedDesktopDays.reduce(
      (total, day) =>
        total + (desktopDayWidths.get(day.dateInput) ?? DESKTOP_DAY_BASE_WIDTH),
      0,
    );

  const gridHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
  const selectedSlot = selected
    ? toDateTimeLocal(selected.day.dateInput, selected.hour, selected.minute)
    : null;
  const selectedTimeOptions = selected
    ? buildTimeOptionsForDay(selected.day)
    : [];
  const mobileDayItems = useMemo(
    () =>
      mobileDay
        ? positionedItemsByDay.get(mobileDay.dateInput) ?? []
        : [],
    [mobileDay, positionedItemsByDay],
  );
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
  const currentDayKey = now ? dateInputForLocalDate(now) : null;
  const currentTimeMinutes = now
    ? (() => {
        const parts = calendarDateParts(now);
        return parts.hour * 60 + parts.minute;
      })()
    : null;
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!previewItem) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewItem(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewItem]);
  useEffect(() => {
    if (!mobileToolsOpen) return;
    const originalOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileToolsOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileToolsOpen]);
  useEffect(() => {
    const scroller = mobileTimelineScrollRef.current;
    if (!scroller || !mobileDay) return;

    const firstItemStart = mobileDayItems.reduce<number | null>(
      (earliest, item) => {
        const start = localMinutesFromIso(item.startsAt);
        return earliest == null || start < earliest ? start : earliest;
      },
      null,
    );
    const focusMinutes = Math.max(
      mobileTimelineStart,
      (firstItemStart ?? mobileDay.workStartMinutes) - 30,
    );
    scroller.scrollTop =
      ((focusMinutes - mobileTimelineStart) / 60) * MOBILE_HOUR_HEIGHT;
  }, [mobileDay, mobileDayItems, mobileTimelineStart]);
  useEffect(() => {
    const scroller = desktopTimelineScrollRef.current;
    if (!scroller || desktopView === "agenda") return;

    const visibleItems = displayedDesktopDays.flatMap(
      (day) => positionedItemsByDay.get(day.dateInput) ?? [],
    );
    const firstItemStart = visibleItems.reduce<number | null>(
      (earliest, item) => {
        const start = localMinutesFromIso(item.startsAt);
        return earliest == null || start < earliest ? start : earliest;
      },
      null,
    );
    const firstWorkStart = displayedDesktopDays.reduce<number | null>(
      (earliest, day) =>
        day.enabled &&
        (earliest == null || day.workStartMinutes < earliest)
          ? day.workStartMinutes
          : earliest,
      null,
    );
    const focusMinutes = Math.max(
      START_HOUR * 60,
      (firstItemStart ?? firstWorkStart ?? START_HOUR * 60) - 30,
    );
    scroller.scrollTop =
      ((focusMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
  }, [desktopView, displayedDesktopDays, positionedItemsByDay]);

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
    if (event.pointerType !== "mouse" || event.button !== 0) return;
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
      try {
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
        if ("warning" in result && result.warning) {
          setMoveError(result.warning);
        }
        router.refresh();
      } catch (error) {
        console.error("[admin-calendar] calendar move request failed", error);
        setMoveError("Could not move that calendar item. Please try again.");
      }
    });
  };

  const openCalendarItem = (item: CalendarItem) => {
    if (
      (item.kind !== "block" && !item.href) ||
      Date.now() < suppressOpenUntilRef.current
    ) {
      return;
    }
    setPreviewItem(item);
  };

  const openCreateSheet = ({
    day,
    startMinutes,
    initialMode = "shoot",
    endMinutes = startMinutes + 60,
  }: {
    day: DayColumn;
    startMinutes: number;
    initialMode?: "shoot" | "block";
    endMinutes?: number;
  }) => {
    setError(null);
    setLookupMessage(null);
    setMode(initialMode);
    setBlockEndsAt(
      toDateTimeLocalFromMinutes(
        day.dateInput,
        Math.min(endMinutes, END_HOUR * 60),
      ),
    );
    setSelected({
      day,
      hour: Math.floor(startMinutes / 60),
      minute: startMinutes % 60,
    });
  };

  const setActiveTimeRangeDrag = (next: TimeRangeDragState | null) => {
    timeRangeDragRef.current = next;
    setTimeRangeDrag(next);
  };

  const beginEmptyRangeSelection = (
    event: PointerEvent<HTMLButtonElement>,
    day: DayColumn,
    startMinutes: number,
  ) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || movePending) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveTimeRangeDrag({
      day,
      pointerId: event.pointerId,
      anchorMinutes: startMinutes,
      currentMinutes: startMinutes,
      startY: event.clientY,
      hasMoved: false,
    });
  };

  const updateEmptyRangeSelection = (
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    const current = timeRangeDragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const column = document.querySelector<HTMLElement>(
      `[data-calendar-drop-day="${current.day.dateInput}"][data-calendar-drop-mode="desktop"]`,
    );
    if (!column) return;
    const rect = column.getBoundingClientRect();
    const rawMinutes =
      START_HOUR * 60 +
      ((event.clientY - rect.top) / HOUR_HEIGHT) * 60;
    const currentMinutes = Math.min(
      Math.max(
        Math.floor(rawMinutes / SLOT_MINUTES) * SLOT_MINUTES,
        START_HOUR * 60,
      ),
      END_HOUR * 60 - SLOT_MINUTES,
    );
    const hasMoved =
      current.hasMoved || Math.abs(event.clientY - current.startY) > 5;
    if (hasMoved) event.preventDefault();
    setActiveTimeRangeDrag({ ...current, currentMinutes, hasMoved });
  };

  const finishEmptyRangeSelection = (
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    const current = timeRangeDragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setActiveTimeRangeDrag(null);
    if (!current.hasMoved) return;

    event.preventDefault();
    suppressSlotClickUntilRef.current = Date.now() + 500;
    const startMinutes = Math.min(
      current.anchorMinutes,
      current.currentMinutes,
    );
    const endMinutes =
      Math.max(current.anchorMinutes, current.currentMinutes) + SLOT_MINUTES;
    openCreateSheet({
      day: current.day,
      startMinutes,
      endMinutes,
      initialMode: "block",
    });
  };

  const cancelEmptyRangeSelection = () => setActiveTimeRangeDrag(null);

  const selectMobileDayByOffset = (offset: number) => {
    if (!mobileDay) return;
    const currentIndex = days.findIndex(
      (day) => day.dateInput === mobileDay.dateInput,
    );
    const next = days[currentIndex + offset];
    if (next) {
      setMobileDayKey(next.dateInput);
    }
  };

  const handleMobileSwipeStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    mobileSwipeRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
  };

  const handleMobileSwipeEnd = (event: TouchEvent<HTMLElement>) => {
    const start = mobileSwipeRef.current;
    mobileSwipeRef.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (Date.now() - start.time > 700) return;
    selectMobileDayByOffset(dx < 0 ? 1 : -1);
  };

  const openAddSheet = (day = mobileDay) => {
    if (!day) return;
    const minutes = defaultMobileAddMinutes(day);
    openCreateSheet({
      day,
      startMinutes: minutes,
    });
  };

  return (
    <div className="max-w-full space-y-3 px-0.5">
      <section className="sticky top-2 z-[80] overflow-visible rounded-3xl border border-realtor-primary/15 bg-realtor-surface/95 p-2 shadow-lg shadow-realtor-text/10 backdrop-blur-xl">
        <div className="md:hidden">
          <div className="flex items-center gap-2">
            <nav
              aria-label="Calendar week navigation"
              className="flex shrink-0 items-center gap-1"
            >
              <Link
                href={navigation.previousHref}
                aria-label="Previous week"
                title="Previous week"
                className="flex h-11 w-11 items-center justify-center rounded-full border border-realtor-primary/15 bg-white text-realtor-muted transition hover:border-realtor-primary/35 hover:text-realtor-primary"
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              </Link>
              <Link
                href={navigation.todayHref}
                className="inline-flex h-11 items-center justify-center rounded-full border border-realtor-primary/25 bg-white px-3 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/45"
              >
                Today
              </Link>
              <Link
                href={navigation.nextHref}
                aria-label="Next week"
                title="Next week"
                className="flex h-11 w-11 items-center justify-center rounded-full border border-realtor-primary/15 bg-white text-realtor-muted transition hover:border-realtor-primary/35 hover:text-realtor-primary"
              >
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </nav>

            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => openAddSheet()}
                aria-label="Add a shoot or blocked time"
                title="Add a shoot or blocked time"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-realtor-primary text-white shadow-sm transition hover:opacity-90"
              >
                <Plus aria-hidden="true" className="h-4.5 w-4.5" />
              </button>
              <button
                type="button"
                onClick={() => setMobileToolsOpen(true)}
                aria-label="Open calendar tools"
                title="Search, calendars, and hours"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-realtor-primary/15 bg-realtor-surface text-realtor-muted transition hover:border-realtor-primary/35 hover:text-realtor-primary"
              >
                <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div
            role="group"
            aria-label="Calendar view"
            className="mt-2 grid grid-cols-2 rounded-xl bg-realtor-soft/70 p-1"
          >
            {(["day", "agenda"] as const).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setMobileView(view)}
                aria-pressed={mobileView === view}
                className={`min-h-11 rounded-lg text-xs font-semibold capitalize outline-none transition focus-visible:ring-2 focus-visible:ring-realtor-primary/40 focus-visible:ring-offset-1 ${
                  mobileView === view
                    ? "bg-realtor-surface text-realtor-primary shadow-sm"
                    : "text-realtor-muted"
                }`}
              >
                {view}
              </button>
            ))}
          </div>

          <div className="mt-2 grid max-w-full grid-cols-7 gap-1 border-t border-realtor-primary/10 pt-2">
            {days.map((day) => {
              const isSelected = day.dateInput === mobileDay?.dateInput;
              const dayItems = itemsByDay.get(day.dateInput) ?? [];
              return (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => setMobileDayKey(day.dateInput)}
                  aria-pressed={isSelected}
                  className={`min-w-0 rounded-lg border px-1 py-1 text-center transition ${
                    isSelected
                      ? "border-realtor-primary bg-realtor-primary text-white shadow-sm"
                      : "border-transparent bg-realtor-soft/65 text-realtor-text hover:border-realtor-primary/20"
                  }`}
                >
                  <span
                    className={`block text-[8px] uppercase tracking-wide ${
                      isSelected ? "text-white/75" : "text-realtor-muted"
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
                          : "bg-realtor-primary"
                        : day.enabled
                          ? isSelected
                            ? "bg-white/45"
                            : "bg-realtor-primary/45"
                          : isSelected
                            ? "bg-white/25"
                            : "bg-realtor-muted/20"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div className="hidden flex-wrap items-center gap-2 md:flex">
          <nav className="flex shrink-0 items-center gap-1">
            <Link
              href={navigation.previousHref}
              aria-label="Previous week"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-realtor-primary/15 bg-white text-realtor-muted transition hover:border-realtor-primary/35 hover:text-realtor-primary"
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link
              href={navigation.todayHref}
              className="inline-flex h-10 items-center justify-center rounded-full border border-realtor-primary/25 bg-white px-4 text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/45"
            >
              Today
            </Link>
            <Link
              href={navigation.nextHref}
              aria-label="Next week"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-realtor-primary/15 bg-white text-realtor-muted transition hover:border-realtor-primary/35 hover:text-realtor-primary"
            >
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </nav>

          <div className="inline-flex rounded-full bg-realtor-primary/5 p-1">
            {(["day", "week", "agenda"] as const).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setDesktopView(view)}
                aria-pressed={desktopView === view}
                className={`min-h-9 rounded-full px-4 text-xs font-semibold capitalize transition ${
                  desktopView === view
                    ? "bg-white text-realtor-primary shadow-sm"
                    : "text-realtor-muted hover:text-realtor-text"
                }`}
              >
                {view}
              </button>
            ))}
          </div>

          <form
            action="/admin/calendar"
            className="order-last flex min-w-0 basis-full gap-1.5 lg:order-none lg:min-w-48 lg:flex-1 lg:basis-48"
          >
            {navigation.weekValue ? (
              <input type="hidden" name="week" value={navigation.weekValue} />
            ) : null}
            <label className="sr-only" htmlFor="calendar-search-desktop">
              Search calendar
            </label>
            <input
              id="calendar-search-desktop"
              name="q"
              defaultValue={navigation.search}
              placeholder="Search calendar"
              className="h-10 min-w-0 flex-1 rounded-full border border-realtor-primary/15 bg-white px-4 text-sm text-realtor-text outline-none transition placeholder:text-realtor-muted/70 focus:border-realtor-primary/45 focus:ring-2 focus:ring-realtor-primary/10"
            />
            <button
              type="submit"
              className="h-10 rounded-full border border-realtor-primary/20 bg-white px-3 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40"
            >
              Search
            </button>
            {navigation.clearSearchHref ? (
              <Link
                href={navigation.clearSearchHref}
                className="inline-flex h-10 items-center rounded-full border border-realtor-primary/15 px-3 text-xs font-semibold text-realtor-muted transition hover:border-realtor-primary/35 hover:text-realtor-primary"
              >
                Clear
              </Link>
            ) : null}
          </form>

          <details className="group relative ml-auto">
            <summary className="inline-flex h-10 cursor-pointer list-none items-center justify-center gap-2 rounded-full border border-realtor-primary/15 bg-white px-3 text-xs font-semibold text-realtor-muted transition hover:border-realtor-primary/35 hover:text-realtor-text [&::-webkit-details-marker]:hidden">
              Calendars
              <ChevronRight
                aria-hidden="true"
                className="h-3 w-3 transition group-open:rotate-90"
              />
            </summary>
            <div className="absolute right-0 top-full z-[120] mt-2 max-h-[70dvh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-realtor-primary/15 bg-realtor-surface p-1 shadow-2xl shadow-realtor-text/20">
              {calendarMenu}
            </div>
          </details>

          <Link
            href="/admin/settings/availability"
            className="inline-flex h-10 items-center justify-center rounded-full border border-realtor-primary/15 bg-white px-3 text-xs font-semibold text-realtor-muted transition hover:border-realtor-primary/35 hover:text-realtor-primary"
          >
            Hours
          </Link>

          <button
            type="button"
            onClick={() => openAddSheet()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-realtor-primary px-4 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add
          </button>
        </div>
      </section>

      {mobileToolsOpen ? (
        <div className="fixed inset-0 z-[190] md:hidden">
          <button
            type="button"
            aria-label="Close calendar tools"
            onClick={() => setMobileToolsOpen(false)}
            className="absolute inset-0 bg-realtor-text/25 backdrop-blur-[2px]"
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-tools-title"
            className="absolute inset-x-2 bottom-[calc(env(safe-area-inset-bottom,0px)+5.25rem)] max-h-[76dvh] overflow-y-auto rounded-2xl border border-realtor-primary/15 bg-realtor-surface p-3 shadow-2xl shadow-realtor-text/25"
          >
            <header className="flex items-center justify-between gap-3 px-1 pb-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-realtor-primary/75">
                  Calendar
                </p>
                <h2
                  id="calendar-tools-title"
                  className="mt-0.5 text-lg font-semibold text-realtor-text"
                >
                  Search and settings
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setMobileToolsOpen(false)}
                aria-label="Close calendar tools"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-realtor-primary/15 bg-white text-realtor-muted"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </header>

            <form action="/admin/calendar" className="flex gap-2">
              {navigation.weekValue ? (
                <input type="hidden" name="week" value={navigation.weekValue} />
              ) : null}
              <label className="sr-only" htmlFor="calendar-search-mobile">
                Search calendar
              </label>
              <div className="relative min-w-0 flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-realtor-muted"
                />
                <input
                  id="calendar-search-mobile"
                  name="q"
                  defaultValue={navigation.search}
                  placeholder="Search bookings"
                  className="h-11 w-full rounded-xl border border-realtor-primary/15 bg-white pl-9 pr-3 text-sm text-realtor-text outline-none placeholder:text-realtor-muted/70 focus:border-realtor-primary/45 focus:ring-2 focus:ring-realtor-primary/10"
                />
              </div>
              <button
                type="submit"
                className="h-11 rounded-xl bg-realtor-primary px-4 text-xs font-semibold text-white"
              >
                Search
              </button>
            </form>
            {navigation.clearSearchHref ? (
              <Link
                href={navigation.clearSearchHref}
                className="mt-2 inline-flex text-xs font-semibold text-realtor-primary"
              >
                Clear current search
              </Link>
            ) : null}

            <Link
              href="/admin/settings/availability"
              className="mt-3 flex items-center gap-3 rounded-xl border border-realtor-primary/10 bg-realtor-soft/65 px-3 py-3 text-sm font-semibold text-realtor-text"
            >
              <Clock3 aria-hidden="true" className="h-4 w-4 text-realtor-primary" />
              Working hours and blocked dates
              <ChevronRight
                aria-hidden="true"
                className="ml-auto h-4 w-4 text-realtor-muted"
              />
            </Link>

            <div className="mt-3 border-t border-realtor-primary/10 pt-1">
              {calendarMenu}
            </div>
          </section>
        </div>
      ) : null}

      {movePending || moveError ? (
        <div
          role={moveError ? "alert" : "status"}
          className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
            moveError
              ? "border-red-700/20 bg-red-50 text-red-800"
              : "border-realtor-primary/15 bg-realtor-primary/5 text-realtor-primary"
          }`}
        >
          {moveError ?? "Moving calendar item..."}
        </div>
      ) : null}

      {desktopView === "day" ? (
        <div className="hidden grid-cols-7 gap-1 rounded-2xl border border-realtor-primary/10 bg-white/70 p-1.5 md:grid">
          {days.map((day) => {
            const selectedDay = day.dateInput === mobileDay?.dateInput;
            return (
              <button
                key={day.key}
                type="button"
                onClick={() => setMobileDayKey(day.dateInput)}
                className={`rounded-xl px-2 py-2 text-center transition ${
                  selectedDay
                    ? "bg-realtor-primary text-white shadow-sm"
                    : "text-realtor-muted hover:bg-realtor-primary/5 hover:text-realtor-text"
                }`}
              >
                <span className="block text-[10px] font-semibold uppercase tracking-wider opacity-75">
                  {day.shortLabel}
                </span>
                <span className="mt-0.5 block text-sm font-semibold">{day.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {desktopView === "agenda" ? (
        <div className="hidden md:block">
          <CalendarAgendaView
            days={days}
            itemsByDay={itemsByDay}
            onOpen={openCalendarItem}
            onAdd={openAddSheet}
          />
        </div>
      ) : (
      <div
        ref={desktopTimelineScrollRef}
        className="hidden max-h-[calc(100dvh-210px)] overflow-auto rounded-3xl border border-realtor-primary/10 bg-realtor-surface/85 shadow-lg shadow-black/10 md:block xl:max-h-[calc(100dvh-190px)]"
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: desktopGridTemplateColumns,
            minWidth: desktopGridMinWidth,
          }}
        >
          <div className="sticky left-0 top-0 z-30 border-b border-realtor-primary/10 bg-realtor-surface px-2 py-3" />
          {displayedDesktopDays.map((day) => (
            <div
              key={day.key}
              className={`sticky top-0 z-20 border-b border-l border-realtor-primary/10 px-3 py-3 ${
                currentDayKey === day.dateInput
                  ? "bg-realtor-primary/5"
                  : "bg-realtor-surface"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <p className="text-xs uppercase tracking-wider text-realtor-muted">
                  {day.shortLabel}
                </p>
                {currentDayKey === day.dateInput ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-realtor-primary" />
                ) : null}
              </div>
              <p className="text-xs font-semibold text-realtor-text">{day.label}</p>
            </div>
          ))}

          <div
            className="sticky left-0 z-20 bg-realtor-surface"
            style={{ height: gridHeight }}
          >
            {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => (
              <div
                key={i}
                className="absolute right-2 text-[10px] text-realtor-muted"
                style={{ top: i * HOUR_HEIGHT - 6 }}
              >
                {formatHour(START_HOUR + i)}
              </div>
            ))}
          </div>

          {displayedDesktopDays.map((day) => (
            <div
              key={day.key}
              data-calendar-drop-day={day.dateInput}
              data-calendar-drop-mode="desktop"
              className="relative border-l border-realtor-primary/10 bg-realtor-bg/60"
              style={{ height: gridHeight }}
            >
              {day.enabled ? (
                <div
                  className="absolute left-0 right-0 bg-realtor-surface ring-1 ring-inset ring-realtor-primary/10"
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
                <div className="absolute inset-0 bg-realtor-soft/70" />
              )}
              {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => (
                <div
                  key={`hour-line-${i}`}
                  className="pointer-events-none absolute left-0 right-0 z-[1] border-t border-realtor-primary/10"
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
                        if (Date.now() < suppressSlotClickUntilRef.current) {
                          return;
                        }
                        openCreateSheet({
                          day,
                          startMinutes: absoluteMinutes,
                        });
                      }}
                      onPointerDown={(event) =>
                        beginEmptyRangeSelection(event, day, absoluteMinutes)
                      }
                      onPointerMove={updateEmptyRangeSelection}
                      onPointerUp={finishEmptyRangeSelection}
                      onPointerCancel={cancelEmptyRangeSelection}
                      className={
                        "absolute left-0 right-0 z-[2] select-none border-t border-realtor-primary/5 transition " +
                        (slotIsWorking
                          ? "hover:bg-realtor-primary/10"
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

              {timeRangeDrag?.hasMoved &&
              timeRangeDrag.day.dateInput === day.dateInput ? (
                <CalendarTimeRangePreview
                  startMinutes={Math.min(
                    timeRangeDrag.anchorMinutes,
                    timeRangeDrag.currentMinutes,
                  )}
                  endMinutes={
                    Math.max(
                      timeRangeDrag.anchorMinutes,
                      timeRangeDrag.currentMinutes,
                    ) + SLOT_MINUTES
                  }
                />
              ) : null}

              {currentDayKey === day.dateInput &&
              currentTimeMinutes != null &&
              currentTimeMinutes >= START_HOUR * 60 &&
              currentTimeMinutes <= END_HOUR * 60 ? (
                <CurrentTimeIndicator
                  top={
                    ((currentTimeMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT
                  }
                />
              ) : null}

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
      )}

      <div className="relative max-w-full space-y-2 pb-28 md:hidden">
        {mobileView === "day" && mobileDay ? (
          <section
            onTouchStart={handleMobileSwipeStart}
            onTouchEnd={handleMobileSwipeEnd}
            className="max-w-full overflow-hidden rounded-3xl border border-realtor-primary/10 bg-realtor-surface shadow-sm shadow-realtor-text/5"
          >
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-realtor-text">
                  {mobileDay.shortLabel}, {mobileDay.label}
                </h2>
                <p className="mt-0.5 text-xs text-realtor-muted">
                  {mobileDayItems.length} item{mobileDayItems.length === 1 ? "" : "s"}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-realtor-primary/15 bg-realtor-soft/65 px-2 py-1 text-[10px] text-realtor-muted">
                {mobileDay.enabled
                  ? `${minutesToLabel(
                      mobileDay.workStartMinutes,
                    )}-${minutesToLabel(mobileDay.workEndMinutes)}`
                  : "Closed"}
              </span>
            </div>

            <div className="border-t border-realtor-primary/10 px-3 pb-3 pt-3">
              <div
                ref={mobileTimelineScrollRef}
                className="h-[68dvh] min-h-[520px] max-h-[720px] overflow-y-auto overscroll-contain rounded-3xl [-webkit-overflow-scrolling:touch]"
              >
              <div
                data-calendar-drop-day={mobileDay.dateInput}
                data-calendar-drop-mode="mobile"
                className="relative overflow-hidden rounded-2xl border border-realtor-primary/15 bg-realtor-bg/60"
                style={{ height: mobileTimelineHeight }}
              >
                {mobileDay.enabled ? (
                  <div
                    className="absolute left-10 right-0 bg-realtor-surface ring-1 ring-inset ring-realtor-primary/10"
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
                  <div className="absolute inset-y-0 left-10 right-0 bg-realtor-soft/70" />
                )}

                {mobileHourMarks.map((minutes) => (
                  <div
                    key={`mobile-hour-${minutes}`}
                    className="pointer-events-none absolute left-0 right-0 z-[1] border-t border-realtor-primary/10"
                    style={{
                      top: ((minutes - mobileTimelineStart) / 60) * MOBILE_HOUR_HEIGHT,
                    }}
                  >
                    <span className="absolute left-1 top-0.5 text-[8px] font-semibold text-realtor-muted">
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
                        openCreateSheet({
                          day: mobileDay,
                          startMinutes: minutes,
                        });
                      }}
                      className={
                        "absolute left-10 right-0 z-[2] border-t border-realtor-primary/5 transition " +
                        (slotIsWorking
                          ? "hover:bg-realtor-primary/10 active:bg-realtor-primary/10"
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

                {currentDayKey === mobileDay.dateInput &&
                currentTimeMinutes != null &&
                currentTimeMinutes >= mobileTimelineStart &&
                currentTimeMinutes <= mobileTimelineEnd ? (
                  <CurrentTimeIndicator
                    top={
                      ((currentTimeMinutes - mobileTimelineStart) / 60) *
                      MOBILE_HOUR_HEIGHT
                    }
                    mobile
                  />
                ) : null}

                {mobileDayItems.length === 0 ? (
                  <div className="absolute left-12 right-2 top-2 z-[3] rounded-lg border border-dashed border-realtor-primary/15 bg-realtor-soft/85 px-2 py-1.5 text-[10px] text-realtor-muted">
                    Nothing booked yet.
                  </div>
                ) : null}

                {mobileDayItems.map((item) => (
                  <MobileTimelineEvent
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    rangeStart={mobileTimelineStart}
                    rangeEnd={mobileTimelineEnd}
                    onOpen={openCalendarItem}
                  />
                ))}
              </div>
              </div>
            </div>
          </section>
        ) : mobileView === "agenda" ? (
          <CalendarAgendaView
            days={days}
            itemsByDay={itemsByDay}
            onOpen={openCalendarItem}
            onAdd={openAddSheet}
            compact
          />
        ) : null}

      </div>

      {previewItem ? (
        <CalendarQuickView
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onChanged={(warning) => {
            setPreviewItem(null);
            setMoveError(warning ?? null);
            router.refresh();
          }}
        />
      ) : null}

      {selected ? (
        <div className="fixed inset-x-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[100] max-h-[calc(100dvh-8rem-env(safe-area-inset-bottom))] overflow-y-auto rounded-2xl border border-realtor-primary/30 bg-realtor-surface/95 p-4 shadow-2xl shadow-realtor-text/15 backdrop-blur-xl md:bottom-[max(1rem,env(safe-area-inset-bottom))] md:left-auto md:max-h-[85dvh] md:w-[560px]">
          <div className="relative pr-16">
            <div>
              <p className="text-sm font-semibold text-realtor-text">
                {selected.day.label} at{" "}
                {formatTime(selected.hour, selected.minute)}
              </p>
              <p className="mt-1 text-xs text-realtor-muted">
                Add a confirmed shoot here, or block the time off privately.
                Admin-created shoots can overlap existing calendar items.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setBlockEndsAt("");
              }}
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
                  const previousStart = selected.hour * 60 + selected.minute;
                  const nextStart = hour * 60 + minute;
                  const blockEndMinutes = minutesFromDateTimeLocal(blockEndsAt);
                  const duration = Math.max(
                    (blockEndMinutes ?? previousStart + 60) - previousStart,
                    SLOT_MINUTES,
                  );
                  setBlockEndsAt(
                    toDateTimeLocalFromMinutes(
                      selected.day.dateInput,
                      Math.min(nextStart + duration, END_HOUR * 60),
                    ),
                  );
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
                if (!blockEndsAt) {
                  setBlockEndsAt(
                    toDateTimeLocalFromMinutes(
                      selected.day.dateInput,
                      selected.hour * 60 + selected.minute + 60,
                    ),
                  );
                }
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
                setBlockEndsAt("");
                router.refresh();
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
                value={blockEndsAt}
                onChange={(event) => setBlockEndsAt(event.currentTarget.value)}
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

function CurrentTimeIndicator({
  top,
  mobile = false,
}: {
  top: number;
  mobile?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute right-0 z-[25] flex items-center ${
        mobile ? "left-10" : "left-0"
      }`}
      style={{ top }}
    >
      <span className="-ml-1 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-white bg-realtor-primary shadow-sm" />
      <span className="h-0.5 flex-1 bg-realtor-primary/70" />
    </div>
  );
}

function CalendarAgendaView({
  days,
  itemsByDay,
  onOpen,
  onAdd,
  compact = false,
}: {
  days: DayColumn[];
  itemsByDay: Map<string, CalendarItem[]>;
  onOpen: (item: CalendarItem) => void;
  onAdd: (day: DayColumn) => void;
  compact?: boolean;
}) {
  const todayKey = dateInputForLocalDate();

  return (
    <section className="overflow-hidden rounded-3xl border border-realtor-primary/15 bg-white/80 shadow-lg shadow-realtor-text/5">
      {days.map((day) => {
        const dayItems = [...(itemsByDay.get(day.dateInput) ?? [])].sort(
          (a, b) =>
            new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
        );
        const isToday = day.dateInput === todayKey;
        return (
          <div
            key={day.key}
            className={`grid border-b border-realtor-primary/10 last:border-b-0 ${
              compact ? "gap-2 px-3 py-3" : "gap-4 px-4 py-4 md:grid-cols-[150px_minmax(0,1fr)]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wider ${
                  isToday ? "text-realtor-primary" : "text-realtor-muted"
                }`}>
                  {day.shortLabel}
                  {isToday ? " · Today" : ""}
                </p>
                <p className="mt-1 text-base font-semibold text-realtor-text">
                  {day.label}
                </p>
                <p className="mt-0.5 text-[11px] text-realtor-muted">
                  {day.enabled
                    ? `${minutesToLabel(day.workStartMinutes)}-${minutesToLabel(day.workEndMinutes)}`
                    : "Closed"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onAdd(day)}
                title={`Add on ${day.label}`}
                aria-label={`Add on ${day.label}`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-realtor-primary/15 bg-white text-lg text-realtor-primary transition hover:border-realtor-primary/35 hover:bg-realtor-primary/5"
              >
                +
              </button>
            </div>

            <div className="min-w-0">
              {dayItems.length > 0 ? (
                <div className="divide-y divide-realtor-primary/10">
                  {dayItems.map((item) => (
                    <AgendaItemRow
                      key={`${item.kind}-${item.id}`}
                      item={item}
                      onOpen={onOpen}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex min-h-12 items-center rounded-xl border border-dashed border-realtor-primary/15 px-3 py-2 text-xs text-realtor-muted">
                  No appointments
                </div>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function AgendaItemRow({
  item,
  onOpen,
}: {
  item: CalendarItem;
  onOpen: (item: CalendarItem) => void;
}) {
  const row = (
    <div className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-3 px-1 py-3 text-left">
      <p className="text-xs font-semibold text-realtor-text">
        {formatAgendaTime(item.startsAt)}
      </p>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-realtor-text">
          {item.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-realtor-muted">
          {item.subtitle}
        </p>
      </div>
      <span
        className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
          item.statusClass ?? calendarItemPillClass(item)
        }`}
      >
        {item.statusLabel ?? calendarItemKindLabel(item)}
      </span>
    </div>
  );

  return item.href || item.kind === "block" ? (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="block w-full transition hover:bg-realtor-primary/5"
    >
      {row}
    </button>
  ) : (
    row
  );
}

function CalendarQuickView({
  item,
  onClose,
  onChanged,
}: {
  item: CalendarItem;
  onClose: () => void;
  onChanged: (warning?: string) => void;
}) {
  const external = item.href?.startsWith("http");
  const details = item.bookingDetails;
  const mapHref = details?.fullAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        details.fullAddress,
      )}`
    : null;
  const initialBookingStart = dateTimeLocalForIso(item.startsAt);
  const [rescheduleDate, setRescheduleDate] = useState(
    initialBookingStart.slice(0, 10),
  );
  const [rescheduleTime, setRescheduleTime] = useState(
    initialBookingStart.slice(11, 16),
  );
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [reschedulePending, startRescheduleTransition] = useTransition();
  const [blockLabel, setBlockLabel] = useState(
    item.kind === "block" && item.title !== "Busy" ? item.title : "",
  );
  const [blockStartsAt, setBlockStartsAt] = useState(() =>
    dateTimeLocalForIso(item.startsAt),
  );
  const [blockEndsAt, setQuickViewBlockEndsAt] = useState(() =>
    dateTimeLocalForIso(item.endsAt),
  );
  const [blockError, setBlockError] = useState<string | null>(null);
  const [blockPending, startBlockTransition] = useTransition();

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const saveBookingReschedule = () => {
    setRescheduleError(null);
    const [hourRaw, minuteRaw] = rescheduleTime.split(":");
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    if (
      !rescheduleDate ||
      !Number.isInteger(hour) ||
      !Number.isInteger(minute) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      setRescheduleError("Choose a valid date and start time.");
      return;
    }

    const startMinutes = hour * 60 + minute;
    startRescheduleTransition(async () => {
      try {
        const result = await rescheduleCalendarShoot(
          item.id,
          rescheduleDate,
          startMinutes,
        );
        if (!result.ok) {
          setRescheduleError(result.error ?? "Could not reschedule this booking.");
          return;
        }
        onChanged(result.warning);
      } catch (error) {
        console.error("[admin-calendar] reschedule request failed", error);
        setRescheduleError("Could not reschedule this booking. Please try again.");
      }
    });
  };

  const saveBlock = () => {
    setBlockError(null);
    startBlockTransition(async () => {
      const formData = new FormData();
      formData.set("starts_at", blockStartsAt);
      formData.set("ends_at", blockEndsAt);
      formData.set("label", blockLabel);
      const result = await updateCalendarBlock(item.id, formData);
      if (!result.ok) {
        setBlockError(result.error ?? "Could not update blocked time.");
        return;
      }
      onChanged();
    });
  };

  const removeBlock = () => {
    if (!window.confirm("Remove this blocked time from the calendar?")) return;
    setBlockError(null);
    startBlockTransition(async () => {
      const result = await deleteCalendarBlock(item.id);
      if (!result.ok) {
        setBlockError(result.error ?? "Could not remove blocked time.");
        return;
      }
      onChanged();
    });
  };

  return (
    <>
      <button
        type="button"
        aria-label="Close calendar details"
        onClick={onClose}
        className="fixed inset-0 z-[90] cursor-default bg-realtor-text/10 backdrop-blur-[1px]"
      />
      <aside
        role="dialog"
        aria-labelledby="calendar-quick-view-title"
        className="fixed inset-x-3 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[100] max-h-[calc(100dvh-8rem-env(safe-area-inset-bottom))] overflow-y-auto rounded-2xl border border-realtor-primary/20 bg-realtor-surface p-5 shadow-2xl shadow-realtor-text/20 md:bottom-auto md:left-auto md:right-5 md:top-20 md:max-h-[86dvh] md:w-[440px]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span
              className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                item.statusClass ?? calendarItemPillClass(item)
              }`}
            >
              {item.statusLabel ?? calendarItemKindLabel(item)}
            </span>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-realtor-muted">
              {formatDateTimeRange(item.startsAt, item.endsAt)}
            </p>
            <h2
              id="calendar-quick-view-title"
              className="mt-1 break-words text-xl font-bold text-realtor-text"
            >
              {item.title}
            </h2>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-realtor-primary/15 bg-white text-xl leading-none text-realtor-muted transition hover:border-realtor-primary/35 hover:text-realtor-text"
          >
            ×
          </button>
        </div>
        {item.kind !== "booking" ? (
          <p className="mt-3 break-words text-sm leading-6 text-realtor-muted">
            {item.subtitle}
          </p>
        ) : null}

        {item.kind === "booking" && details ? (
          <section
            data-calendar-quick-summary
            className="mt-4 space-y-3 rounded-2xl border border-realtor-primary/15 bg-realtor-soft/60 p-3"
          >
            {item.syncWarning ? (
              <p
                role="alert"
                data-calendar-sync-warning
                className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-900"
              >
                {item.syncWarning}. Verify the connected Google event before
                making another schedule change.
              </p>
            ) : null}

            {details.fullAddress ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-realtor-muted">
                  Address
                </p>
                <p className="mt-1 text-sm font-semibold leading-5 text-realtor-text">
                  {details.fullAddress}
                </p>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3 border-t border-realtor-primary/10 pt-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-realtor-muted">Client</p>
                <p className="mt-1 truncate text-sm font-semibold text-realtor-text">
                  {details.realtorName}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-realtor-muted">Services</p>
                <p className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-realtor-text">
                  {details.services.join(", ") || "Not set"}
                </p>
                {details.addOns.length ? (
                  <p className="mt-1 line-clamp-1 text-[11px] text-realtor-muted">
                    + {details.addOns.join(", ")}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-realtor-primary/10 pt-3">
              {item.href ? (
                <Link
                  href={item.href}
                  className="inline-flex min-h-10 flex-1 basis-28 items-center justify-center rounded-full bg-realtor-primary px-4 text-xs font-semibold text-white transition hover:opacity-90"
                >Open job</Link>
              ) : null}
              {mapHref ? (
                <a
                  href={mapHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-10 items-center justify-center rounded-full border border-realtor-primary/20 bg-white px-3 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40"
                >Directions</a>
              ) : null}
              {details.realtorPhone ? (
                <a
                  href={`tel:${details.realtorPhone}`}
                  className="inline-flex min-h-10 items-center justify-center rounded-full border border-realtor-primary/20 bg-white px-3 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40"
                >Call</a>
              ) : null}
            </div>
          </section>
        ) : null}

        {item.kind === "booking" ? (
          <details className="mt-3 rounded-2xl border border-realtor-primary/15 bg-realtor-soft/60 p-3">
            <summary className="cursor-pointer list-none text-sm font-semibold text-realtor-primary marker:hidden">
              <span className="flex items-center justify-between gap-3">
                Change date & time
                <span aria-hidden="true" className="text-lg leading-none">
                  +
                </span>
              </span>
            </summary>
            <div className="mt-3 space-y-3 border-t border-realtor-primary/10 pt-3">
              <p className="text-xs leading-5 text-realtor-muted">
                The shoot duration stays the same. We’ll move the booking and
                update its connected Google Calendar event; if Google cannot
                sync, you’ll see a warning.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="block min-w-0">
                  <span className="text-xs font-semibold text-realtor-muted">
                    New date
                  </span>
                  <input
                    type="date"
                    value={rescheduleDate}
                    onChange={(event) => setRescheduleDate(event.target.value)}
                    className="mt-1 box-border w-full min-w-0 rounded-xl border border-realtor-primary/15 bg-white px-3 py-2.5 text-sm text-realtor-text outline-none focus:border-realtor-primary/45"
                  />
                </label>
                <label className="block min-w-0">
                  <span className="text-xs font-semibold text-realtor-muted">
                    Start time
                  </span>
                  <input
                    type="time"
                    step={300}
                    value={rescheduleTime}
                    onChange={(event) => setRescheduleTime(event.target.value)}
                    className="mt-1 box-border w-full min-w-0 rounded-xl border border-realtor-primary/15 bg-white px-3 py-2.5 text-sm text-realtor-text outline-none focus:border-realtor-primary/45"
                  />
                </label>
              </div>
              {rescheduleError ? (
                <p role="alert" className="text-xs text-red-700">
                  {rescheduleError}
                </p>
              ) : null}
              <button
                type="button"
                disabled={reschedulePending || !rescheduleDate || !rescheduleTime}
                onClick={saveBookingReschedule}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-realtor-primary px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {reschedulePending ? "Rescheduling..." : "Save new date & time"}
              </button>
            </div>
          </details>
        ) : null}

        {item.kind === "block" ? (
          <section className="mt-5 space-y-3 border-t border-realtor-primary/10 pt-4">
            <div>
              <p className="text-sm font-semibold text-realtor-text">
                Edit blocked time
              </p>
              <p className="mt-1 text-xs leading-5 text-realtor-muted">
                On mobile, blocked time opens here instead of moving when you
                scroll over it.
              </p>
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-realtor-muted">
                Label
              </span>
              <input
                type="text"
                value={blockLabel}
                onChange={(event) => setBlockLabel(event.target.value)}
                placeholder="Personal appointment"
                className="mt-1 w-full rounded-xl border border-realtor-primary/15 bg-white px-3 py-2.5 text-sm text-realtor-text outline-none focus:border-realtor-primary/45"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold text-realtor-muted">
                  Starts
                </span>
                <input
                  type="datetime-local"
                  value={blockStartsAt}
                  onChange={(event) => setBlockStartsAt(event.target.value)}
                  className="mt-1 box-border w-full min-w-0 rounded-xl border border-realtor-primary/15 bg-white px-3 py-2.5 text-sm text-realtor-text outline-none focus:border-realtor-primary/45"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-realtor-muted">
                  Ends
                </span>
                <input
                  type="datetime-local"
                  value={blockEndsAt}
                  onChange={(event) =>
                    setQuickViewBlockEndsAt(event.target.value)
                  }
                  className="mt-1 box-border w-full min-w-0 rounded-xl border border-realtor-primary/15 bg-white px-3 py-2.5 text-sm text-realtor-text outline-none focus:border-realtor-primary/45"
                />
              </label>
            </div>
            {blockError ? (
              <p role="alert" className="text-xs text-red-700">
                {blockError}
              </p>
            ) : null}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <button
                type="button"
                disabled={blockPending}
                onClick={saveBlock}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-realtor-primary px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {blockPending ? "Saving..." : "Save changes"}
              </button>
              <button
                type="button"
                disabled={blockPending}
                onClick={removeBlock}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
              >
                Remove
              </button>
            </div>
          </section>
        ) : null}

        {item.kind === "booking" && details ? (
          <details
            data-calendar-more-details
            className="mt-3 rounded-2xl border border-realtor-primary/15 bg-white/50 p-3"
          >
            <summary className="cursor-pointer list-none text-sm font-semibold text-realtor-muted marker:hidden">
              <span className="flex items-center justify-between gap-3">
                More booking details
                <span aria-hidden="true" className="text-lg leading-none">
                  +
                </span>
              </span>
            </summary>
            <div className="mt-3 space-y-3 border-t border-realtor-primary/10 pt-3">
              <div className="grid grid-cols-2 gap-2">
                <QuickViewFact
                  label="Square feet"
                  value={
                    details.squareFootage
                      ? details.squareFootage.toLocaleString("en-CA")
                      : "Not set"
                  }
                />
                <QuickViewFact
                  label="Occupancy"
                  value={details.occupancy ?? "Not set"}
                />
                <QuickViewFact
                  label="Basement"
                  value={
                    details.includeBasement == null
                      ? "Not set"
                      : details.includeBasement
                        ? "Include"
                        : "Skip"
                  }
                />
                <QuickViewFact
                  label="Brokerage"
                  value={details.brokerage ?? "Not set"}
                />
              </div>

              {details.realtorEmail || details.realtorPhone ? (
                <QuickViewSection label="Contact">
                  {details.realtorEmail ? (
                    <p className="break-all text-xs text-realtor-muted">
                      {details.realtorEmail}
                    </p>
                  ) : null}
                  {details.realtorPhone ? (
                    <p className="mt-1 text-xs text-realtor-muted">
                      {details.realtorPhone}
                    </p>
                  ) : null}
                </QuickViewSection>
              ) : null}

              {details.realtorNotes ? (
                <QuickViewNote label="Agent notes" body={details.realtorNotes} />
              ) : null}
              {details.clientNotes ? (
                <QuickViewNote label="Realtor request" body={details.clientNotes} />
              ) : null}
              {details.propertyNotes ? (
                <QuickViewNote label="Property notes" body={details.propertyNotes} />
              ) : null}
              {details.internalNotes ? (
                <QuickViewNote label="Internal notes" body={details.internalNotes} />
              ) : null}
            </div>
          </details>
        ) : null}

        {item.href && item.kind !== "booking" ? (
          <Link
            href={item.href}
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer" : undefined}
            className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-realtor-primary px-4 text-sm font-semibold text-white transition hover:opacity-90"
          >
            {item.kind === "google" ? "Open Google event" : "Open booking"}
          </Link>
        ) : null}
      </aside>
    </>
  );
}

function QuickViewSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-realtor-muted">
        {label}
      </p>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

function QuickViewFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-realtor-primary/10 bg-white/65 px-3 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-realtor-muted">
        {label}
      </p>
      <p className="mt-1 line-clamp-2 text-xs font-semibold text-realtor-text">
        {value}
      </p>
    </div>
  );
}

function QuickViewNote({ label, body }: { label: string; body: string }) {
  return (
    <section className="rounded-xl border border-amber-700/15 bg-amber-50 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">
        {label}
      </p>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-5 text-amber-950">
        {body}
      </p>
    </section>
  );
}

function calendarItemKindLabel(item: CalendarItem): string {
  if (item.kind === "block") return "Blocked";
  if (item.kind === "google") return "Google";
  return "Shoot";
}

function calendarItemPillClass(item: CalendarItem): string {
  if (item.kind === "google") return "border-sky-200 bg-sky-50 text-sky-800";
  if (item.kind === "block") return "border-stone-300 bg-stone-100 text-stone-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function calendarEventSurfaceClass(item: CalendarItem): string {
  switch (item.statusLabel?.toLowerCase()) {
    case "requested":
      return "border-[#a9b7cf] bg-[#e9eef6] text-[#27364d] hover:bg-[#dfe7f2]";
    case "shot":
      return "border-[#9aaeb8] bg-[#e7eef1] text-[#263c46] hover:bg-[#dce7eb]";
    case "editing":
      return "border-[#c4ae7b] bg-[#f3eddf] text-[#51452b] hover:bg-[#ece3cf]";
    case "delivered":
      return "border-[#b6b5ac] bg-[#efeee9] text-[#3f433f] hover:bg-[#e5e4de]";
    default:
      return "border-[#8ba98f] bg-[#dce9dc] text-realtor-text hover:bg-[#d2e1d2]";
  }
}

function formatAgendaTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CALENDAR_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
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
  onOpen,
}: {
  item: PositionedCalendarItem;
  rangeStart: number;
  rangeEnd: number;
  onOpen: (item: CalendarItem) => void;
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
      ? calendarEventSurfaceClass(item)
      : item.kind === "google"
        ? "text-[#17465b]"
        : "border-realtor-primary/15 bg-realtor-soft text-realtor-text";
  const sourceStyle = calendarSourceEventStyle(item);
  const canOpen = item.kind === "block" || Boolean(item.href);
  const body = (
    <div className="h-full min-w-0">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wider opacity-70">
          {formatDateTimeRange(item.startsAt, item.endsAt)}
        </p>
        <span className="shrink-0 rounded-full border border-current/20 bg-white/40 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider">
          {item.statusLabel ??
            (item.kind === "block"
              ? "Blocked"
              : item.kind === "google"
                ? "Google"
                : "Shoot")}
        </span>
      </div>
      <p className="mt-1.5 line-clamp-2 break-words text-[13px] font-semibold leading-tight">
        {item.title}
      </p>
      <p className="mt-1 line-clamp-1 break-words text-[11px] leading-snug opacity-75">
        {item.subtitle}
      </p>
    </div>
  );
  const layoutStyle = {
    ...eventLayoutStyle({ top, height, layout: item.layout, mobile: true }),
    ...sourceStyle,
  };
  const eventClass = `absolute z-10 overflow-hidden rounded-2xl border px-2.5 py-1.5 text-left shadow-sm ${classes}`;

  if (canOpen) {
    return (
      <button
        type="button"
        aria-label={
          item.kind === "block"
            ? `Edit blocked time: ${item.title}`
            : `Open ${item.title}`
        }
        onClick={() => onOpen(item)}
        className={`${eventClass} touch-pan-y transition active:scale-[0.99]`}
        style={layoutStyle}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={eventClass} style={layoutStyle}>
      {body}
    </div>
  );
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
  const height = Math.max(((endMinutes - startMinutes) / 60) * HOUR_HEIGHT, 56);
  const canMove = item.kind === "booking" || item.kind === "block";
  const classes =
    item.kind === "booking"
      ? calendarEventSurfaceClass(item)
      : item.kind === "google"
        ? "text-[#17465b]"
        : "border-[#a69d8d]/45 bg-[#c9c3b6]/80 text-[#36423a] hover:bg-[#beb7aa]";
  const sourceStyle = calendarSourceEventStyle(item);
  const layoutStyle = {
    ...eventLayoutStyle({
      top: Math.max(top, 0),
      height,
      layout: item.layout,
    }),
    ...sourceStyle,
  };
  const body = (
    <div className="flex h-full min-w-0 flex-col justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
          {formatDateTimeRange(item.startsAt, item.endsAt)}
        </p>
        <p className="mt-1 line-clamp-2 break-words text-sm font-semibold leading-tight">
          {item.title}
        </p>
        <p className="mt-1 line-clamp-2 break-words text-xs leading-snug opacity-85">
          {item.subtitle}
        </p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {item.statusLabel ? (
          <span
            className={`inline-block rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${item.statusClass}`}
          >
            {item.statusLabel}
          </span>
        ) : null}
        {canMove ? (
          <span className="rounded-full border border-current/20 bg-white/35 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider opacity-75">
            Drag
          </span>
        ) : item.href ? (
          <span className="rounded-full border border-current/20 bg-white/35 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider opacity-75">
            Details
          </span>
        ) : null}
      </div>
    </div>
  );
  const baseClass = `absolute z-10 block overflow-hidden rounded-2xl border px-3 py-2 text-left shadow-sm transition ${classes}`;

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
        className={`${baseClass} select-none ${
          isDragging
            ? "scale-[0.98] opacity-35"
            : "cursor-grab active:cursor-grabbing"
        }`}
        style={layoutStyle}
      >
        {body}
      </button>
    );
  }

  if (item.href) {
    return (
      <button
        type="button"
        aria-label={`Open details for ${item.title}`}
        onClick={() => onOpen(item)}
        className={baseClass}
        style={layoutStyle}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={baseClass} style={layoutStyle}>
      {body}
    </div>
  );
}

function CalendarTimeRangePreview({
  startMinutes,
  endMinutes,
}: {
  startMinutes: number;
  endMinutes: number;
}) {
  const top = ((startMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
  const height = ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-1 right-1 z-[8] overflow-hidden rounded-xl border-2 border-dashed border-realtor-primary bg-realtor-primary/15 px-2 py-1.5 text-realtor-primary shadow-sm"
      style={{ top, height }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider">
        Block this time
      </p>
      <p className="mt-0.5 text-xs font-semibold">
        {minutesToLabel(startMinutes)}-{minutesToLabel(endMinutes)}
      </p>
    </div>
  );
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
      className={`pointer-events-none absolute z-30 overflow-hidden rounded-xl border-2 border-[#3f7356] bg-[#e8f1e8]/95 px-2.5 py-1.5 text-left text-realtor-text shadow-xl shadow-[#23332b]/20 ring-2 ring-[#3f7356]/20 ${
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

function calendarSourceEventStyle(item: CalendarItem): CSSProperties {
  if (item.kind !== "google" || !isHexColor(item.sourceColor)) return {};
  return {
    borderColor: hexToRgba(item.sourceColor, 0.58),
    backgroundColor: hexToRgba(item.sourceColor, 0.18),
    boxShadow: `inset 3px 0 0 ${item.sourceColor}`,
  };
}

function isHexColor(value: string | undefined): value is string {
  return Boolean(value && /^#[0-9a-fA-F]{6}$/.test(value));
}

function hexToRgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function parseLocalParts(iso: string): { hour: number; minute: number } {
  const parts = calendarDateParts(new Date(iso));
  return { hour: parts.hour, minute: parts.minute };
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

function defaultMobileAddMinutes(day: DayColumn): number {
  const timelineStart = START_HOUR * 60;
  const timelineEnd = END_HOUR * 60;
  const firstWorking = Math.min(
    Math.max(day.workStartMinutes, timelineStart),
    timelineEnd - SLOT_MINUTES,
  );
  if (!day.enabled) return firstWorking;
  if (day.dateInput !== dateInputForLocalDate()) return firstWorking;

  const now = new Date();
  const nowParts = calendarDateParts(now);
  const roundedNow =
    Math.ceil((nowParts.hour * 60 + nowParts.minute) / SLOT_MINUTES) *
    SLOT_MINUTES;
  return Math.min(
    Math.max(roundedNow, firstWorking),
    Math.min(day.workEndMinutes, timelineEnd) - SLOT_MINUTES,
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
    timeZone: CALENDAR_TIME_ZONE,
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

function toDateTimeLocalFromMinutes(date: string, totalMinutes: number): string {
  const normalized = Math.min(Math.max(totalMinutes, 0), 23 * 60 + 59);
  return toDateTimeLocal(
    date,
    Math.floor(normalized / 60),
    normalized % 60,
  );
}

function dateTimeLocalForIso(iso: string): string {
  const parts = calendarDateParts(new Date(iso));
  return toDateTimeLocal(
    `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
      parts.day,
    ).padStart(2, "0")}`,
    parts.hour,
    parts.minute,
  );
}

function minutesFromDateTimeLocal(value: string): number | null {
  const match = value.match(/T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return Number.isFinite(hour) && Number.isFinite(minute)
    ? hour * 60 + minute
    : null;
}

function dateInputForLocalDate(date = new Date()): string {
  const parts = calendarDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day,
  ).padStart(2, "0")}`;
}

function calendarDateParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = calendarPartsFormatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}
