"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InputHTMLAttributes, ReactNode } from "react";
import { useEffect, useMemo, useState, useTransition } from "react";

import AddressAutocomplete, {
  type PlaceParts,
} from "@/app/_components/AddressAutocomplete";
import { addCalendarBlock } from "@/app/admin/settings/availability/actions";
import {
  createAdminShoot,
  searchRealtors,
  type RealtorSearchItem,
} from "./actions";

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

  const gridHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
  const selectedSlot = selected
    ? toDateTimeLocal(selected.day.dateInput, selected.hour, selected.minute)
    : null;
  const mobileDay =
    days.find((day) => day.dateInput === mobileDayKey) ?? days[0] ?? null;
  const mobileDayItems = mobileDay
    ? itemsByDay.get(mobileDay.dateInput) ?? []
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

  return (
    <div className="max-w-full space-y-3 overflow-hidden md:space-y-4">
      <div className="hidden text-ink-muted md:flex md:flex-wrap md:items-center md:gap-3 md:text-xs">
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
                  const hour = START_HOUR + Math.floor(minutes / 60);
                  const minute = minutes % 60;
                  return (
                    <button
                      key={slot}
                      type="button"
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
                      className="absolute left-0 right-0 z-[2] border-t border-[#ede6d9]/60 transition hover:bg-[#3f7356]/10"
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

        <div className="grid max-w-full grid-cols-3 gap-1 rounded-xl border border-[#d8cab9]/70 bg-[#fffdf8]/75 p-1.5 text-[9px] text-[#6f7a70]">
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
                className="relative mt-3 overflow-hidden rounded-2xl border border-[#d8cab9] bg-[#d7d1c4]/55"
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
                  return (
                    <button
                      key={`${slot.hour}:${slot.minute}`}
                      type="button"
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
                      className="absolute left-10 right-0 z-[2] border-t border-[#ede6d9]/60 transition hover:bg-[#3f7356]/10 active:bg-[#3f7356]/10"
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
                  />
                ))}
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {selected ? (
        <div className="fixed inset-x-4 bottom-4 z-50 max-h-[82vh] overflow-y-auto rounded-2xl border border-brand/30 bg-ink-soft p-4 shadow-2xl shadow-black/50 md:left-auto md:w-[560px]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">
                {selected.day.label} at{" "}
                {formatTime(selected.hour, selected.minute)}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Add a confirmed shoot here, or block the time off privately.
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

          <label className="mt-4 block rounded-2xl border border-white/10 bg-ink/60 p-3">
            <span className="text-xs font-semibold text-ink-muted">
              Adjust time manually
            </span>
            <input
              type="time"
              value={`${String(selected.hour).padStart(2, "0")}:${String(
                selected.minute,
              ).padStart(2, "0")}`}
              step={SLOT_MINUTES * 60}
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
              className="mt-1 w-full rounded-xl border border-white/10 bg-ink px-3 py-2 text-sm text-white"
            />
          </label>

          <div className="mt-4 inline-flex rounded-full border border-white/10 bg-ink p-1 text-xs">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("shoot");
              }}
              className={`rounded-full px-3 py-1.5 ${
                mode === "shoot"
                  ? "bg-brand text-white"
                  : "text-ink-muted hover:text-white"
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
              className={`rounded-full px-3 py-1.5 ${
                mode === "block"
                  ? "bg-brand text-white"
                  : "text-ink-muted hover:text-white"
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
                    <span className="text-xs text-ink-muted">Realtor name</span>
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
                        className="w-full rounded-xl border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                      />
                      {isRealtorSearchOpen && realtorSearchResults.length > 0 ? (
                        <ul className="absolute left-0 right-0 z-30 mt-1 max-h-60 overflow-auto rounded-xl border border-white/10 bg-ink shadow-2xl shadow-black/40">
                          {realtorSearchResults.map((result) => (
                            <li key={result.id}>
                              <button
                                type="button"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  selectRealtor(result);
                                }}
                                className="block w-full px-3 py-2 text-left text-sm text-white transition hover:bg-brand/15"
                              >
                                <span className="block font-semibold">
                                  {result.fullName || result.email}
                                </span>
                                <span className="block truncate text-xs text-ink-muted">
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
                  <p className="text-xs text-brand-light">
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
                <span className="text-xs text-ink-muted">Notes</span>
                <textarea
                  name="notes"
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                />
              </label>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-light disabled:opacity-60"
                >
                  {pending ? "Adding..." : "Add confirmed shoot"}
                </button>
                {error ? (
                  <p className="text-sm text-red-300" role="alert">
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
                className="mt-1 w-full rounded-xl border border-white/10 bg-ink px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="block">
              <span className="text-xs text-ink-muted">Private label</span>
              <input
                type="text"
                name="label"
                defaultValue="Busy"
                className="mt-1 w-full rounded-xl border border-white/10 bg-ink px-3 py-2 text-sm text-white"
              />
            </label>
            <button
              type="submit"
              disabled={pending}
              className="self-end rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-light disabled:opacity-60"
            >
              {pending ? "Adding..." : "Add block"}
            </button>
            {error ? (
              <p className="md:col-span-3 text-sm text-red-300" role="alert">
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
      <span className="text-xs text-ink-muted">{label}</span>
      <input
        {...props}
        className="mt-1 w-full rounded-xl border border-white/10 bg-ink px-3 py-2 text-sm text-white"
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
    <section className="space-y-3 border-t border-white/10 pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand/40 bg-brand/10 text-xs font-semibold text-brand-light">
          {step}
        </span>
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <p className="text-xs text-ink-muted">{detail}</p>
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
            <legend className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              {group.title}
            </legend>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {groupItems.map((item) => (
                <label
                  key={item.id}
                  className="flex min-h-[76px] gap-3 rounded-2xl border border-white/10 bg-ink p-3 text-sm text-white transition hover:border-brand/40 hover:bg-white/[0.03]"
                >
                  <input
                    type="checkbox"
                    name="catalog_item_id"
                    value={item.id}
                    className="mt-1 h-4 w-4 rounded border-white/20 bg-ink"
                  />
                  <span>
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      {item.name}
                      {item.badge ? (
                        <span className="rounded border border-brand/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-brand-light">
                          {item.badge}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs text-ink-muted">
                      {formatPrice(item.priceCents)} ·{" "}
                      {formatDuration(item.durationMinutes)}
                      {item.requireHasVideo ? " · needs video" : ""}
                    </span>
                    {item.description ? (
                      <span className="mt-1 line-clamp-2 block text-xs text-ink-muted">
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

function MobileTimelineEvent({
  item,
  rangeStart,
  rangeEnd,
}: {
  item: CalendarItem;
  rangeStart: number;
  rangeEnd: number;
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
      ? "border-[#8ba98f] bg-[#dce9dc] text-[#23332b]"
      : "border-[#a69d8d]/50 bg-[#d7d1c4] text-[#36423a]";
  const content = (
    <div
      className={`absolute left-12 right-1.5 z-10 overflow-hidden rounded-xl border px-2.5 py-1.5 shadow-sm ${classes}`}
      style={{ top, height }}
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
          {item.statusLabel ?? (item.kind === "block" ? "Blocked" : "Shoot")}
        </span>
      </div>
    </div>
  );

  return item.href ? <Link href={item.href}>{content}</Link> : content;
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
      ? "border-[#8ba98f] bg-[#dce9dc] text-[#23332b] hover:bg-[#d2e1d2]"
      : "border-[#a69d8d]/45 bg-[#c9c3b6]/80 text-[#36423a]";
  const content = (
    <div
      className={`absolute left-1 right-1 z-10 overflow-hidden rounded-xl border px-2 py-1 text-left shadow-sm ${classes}`}
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

function localMinutesFromIso(iso: string): number {
  const parts = parseLocalParts(iso);
  return parts.hour * 60 + parts.minute;
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
