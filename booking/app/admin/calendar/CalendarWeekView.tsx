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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-white/[0.08] ring-1 ring-white/15" />
          Working hours
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-black/35 ring-1 ring-white/10" />
          Blocked/off hours
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-brand/25 ring-1 ring-brand-light/50" />
          Shoot
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-ink-soft/45 shadow-lg shadow-black/10">
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
              className="relative border-l border-white/10 bg-black/25"
              style={{ height: gridHeight }}
            >
              {day.enabled ? (
                <div
                  className="absolute left-0 right-0 bg-white/[0.075] ring-1 ring-inset ring-white/10"
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
                <div className="absolute inset-0 bg-black/25" />
              )}
              {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => (
                <div
                  key={`hour-line-${i}`}
                  className="pointer-events-none absolute left-0 right-0 z-[1] border-t border-white/[0.09]"
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
                      className="absolute left-0 right-0 z-[2] border-t border-white/[0.035] transition hover:bg-brand/15"
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

      <div className="rounded-2xl border border-white/10 bg-ink-soft/45 p-4 md:hidden">
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
                            className="block rounded-xl border border-white/10 bg-ink px-3 py-2"
                          >
                            <MobileItem item={item} />
                          </Link>
                        ) : (
                          <div className="rounded-xl border border-white/10 bg-ink px-3 py-2">
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
