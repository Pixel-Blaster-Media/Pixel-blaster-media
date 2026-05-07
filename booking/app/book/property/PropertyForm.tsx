"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import AddressAutocomplete, {
  type PlaceParts,
} from "@/app/_components/AddressAutocomplete";
import type { VacancyState } from "@/lib/booking/wizard-state";

const SHOT_REQUEST_OPTIONS = [
  { slug: "pool", label: "Pool / backyard", helper: "Outdoor features, patio, landscaping." },
  { slug: "view", label: "View / exterior", helper: "Views, curb appeal, corner lot, street context." },
  { slug: "upgrades", label: "Upgrades / details", helper: "Kitchen, bath, finishes, custom features." },
  { slug: "basement", label: "Basement", helper: "Finished lower level, rec room, separate entrance." },
  { slug: "mechanicals", label: "Mechanicals", helper: "Furnace, panel, utility room, systems." },
  { slug: "neighbourhood", label: "Neighbourhood", helper: "Park, school, lake, trail, community features." },
];

/**
 * Step 2 — property details.
 *
 * Pre-fills all fields from URL state on revisit so the user doesn't
 * lose their input when they go back to edit services.
 *
 * When the user picks a Google Places suggestion in the address field,
 * we autofill city + postal from the parsed components. They can still
 * edit those fields manually. Unit number is always a separate field
 * because Google doesn't populate it consistently.
 */
export default function PropertyForm({
  initial,
}: {
  initial: {
    address: string;
    unit: string;
    city: string;
    postal: string;
    sqft: string;
    vacant: VacancyState | "";
    basement: "1" | "0" | "";
    shotRequests: string[];
    shootNotes: string;
  };
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [address, setAddress] = useState(initial.address);
  const [unit, setUnit] = useState(initial.unit);
  const [city, setCity] = useState(initial.city);
  const [postal, setPostal] = useState(initial.postal);
  const [sqft, setSqft] = useState(initial.sqft);
  const [vacant, setVacant] = useState<VacancyState | "">(initial.vacant);
  const [basement, setBasement] = useState<"1" | "0" | "">(initial.basement);
  const [shotRequests, setShotRequests] = useState<string[]>(initial.shotRequests);
  const [shootNotes, setShootNotes] = useState(initial.shootNotes);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handlePlacePicked(parts: PlaceParts) {
    setAddress(parts.street_address || parts.formatted_address || address);
    if (parts.unit_number && !unit) setUnit(parts.unit_number);
    if (parts.city) setCity(parts.city);
    if (parts.postal_code) setPostal(parts.postal_code);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!address.trim()) next.address = "Required — autocomplete or type it in.";
    if (!city.trim()) next.city = "Required — can't book without a city.";
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }

    // Carry forward all prior params (services, add_ons) + our new ones.
    const out = new URLSearchParams(params.toString());
    out.set("address", address.trim());
    if (unit.trim()) out.set("unit", unit.trim());
    else out.delete("unit");
    out.set("city", city.trim());
    if (postal.trim()) out.set("postal", postal.trim());
    else out.delete("postal");
    if (sqft.trim()) out.set("sqft", sqft.trim());
    else out.delete("sqft");
    if (vacant) out.set("vacant", vacant);
    else out.delete("vacant");
    if (basement) out.set("basement", basement);
    else out.delete("basement");
    if (shotRequests.length) out.set("shots", shotRequests.join(","));
    else out.delete("shots");
    if (shootNotes.trim()) out.set("shoot_notes", shootNotes.trim());
    else out.delete("shoot_notes");
    // Dropping an old slot — if they edit property details, the time
    // may no longer make sense for the new service duration anyway.
    out.delete("slot");

    router.push(`/book/schedule?${out.toString()}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <section className="realtor-elevated-panel rounded-3xl p-4 md:p-5">
        <AddressAutocomplete
          name="address"
          label="Property address"
          required
          placeholder="Start typing an address…"
          defaultValue={address}
          onPlace={handlePlacePicked}
          onChange={setAddress}
          error={errors.address}
        />

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field
            label="Unit / Suite #"
            name="unit"
            placeholder="e.g. 4B, PH-2, #212"
            value={unit}
            onChange={setUnit}
          />
          <Field
            label="City"
            name="city"
            required
            value={city}
            onChange={setCity}
            error={errors.city}
          />
          <Field
            label="Postal code"
            name="postal"
            placeholder="L8P 4S8"
            value={postal}
            onChange={setPostal}
          />
          <Field
            label="Approx. square footage"
            name="sqft"
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="e.g. 2000"
            value={sqft}
            onChange={setSqft}
            helper="For iGUIDE measuring, include finished basement or lower-level space if it should be measured. This affects iGUIDE pricing."
          />
        </div>
      </section>

      <fieldset className="realtor-warm-panel rounded-3xl p-4 md:p-5">
        <legend className="sr-only">Is the property occupied?</legend>
        <p className="text-xs font-medium uppercase tracking-wider text-realtor-muted">
          Is the property occupied?
        </p>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <RadioCard
            name="vacant"
            value="vacant"
            label="Vacant"
            helper="No furniture, no tenants."
            current={vacant}
            onSelect={setVacant}
          />
          <RadioCard
            name="vacant"
            value="occupied"
            label="Occupied"
            helper="Furniture / tenants / owners on site."
            current={vacant}
            onSelect={setVacant}
          />
          <RadioCard
            name="vacant"
            value="partial"
            label="Partially occupied"
            helper="Some rooms furnished, some empty."
            current={vacant}
            onSelect={setVacant}
          />
        </div>
      </fieldset>

      <fieldset className="realtor-warm-panel rounded-3xl p-4 md:p-5">
        <legend className="sr-only">Include basement in the shoot?</legend>
        <p className="text-xs font-medium uppercase tracking-wider text-realtor-muted">
          Include basement in the shoot?
        </p>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <RadioCard
            name="basement"
            value="1"
            label="Yes, shoot the basement"
            helper="Finished basements add ~15 min."
            current={basement}
            onSelect={(v) => setBasement(v as "1" | "0")}
          />
          <RadioCard
            name="basement"
            value="0"
            label="No basement / skip it"
            helper="Unfinished, unsafe, or not part of the listing."
            current={basement}
            onSelect={(v) => setBasement(v as "1" | "0")}
          />
        </div>
      </fieldset>

      <section className="realtor-green-panel rounded-3xl p-4 md:p-5">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-light">
            Must-have shots
          </p>
          <h3 className="mt-1 text-base font-semibold text-realtor-text">
            Anything specific we should make sure to capture?
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-realtor-muted">
            This helps avoid the classic “I wish we got that angle” problem. Pick anything important and add notes if there’s a specific feature or request.
          </p>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {SHOT_REQUEST_OPTIONS.map((option) => {
            const selected = shotRequests.includes(option.slug);
            return (
              <button
                key={option.slug}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  setShotRequests((current) =>
                    current.includes(option.slug)
                      ? current.filter((s) => s !== option.slug)
                      : [...current, option.slug],
                  )
                }
                className={
                  "realtor-service-tile rounded-2xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-realtor-primary/35 " +
                  (selected
                    ? "realtor-service-tile-selected text-realtor-text"
                    : "text-realtor-text/90")
                }
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span
                    aria-hidden="true"
                    className={
                      "flex h-5 w-5 items-center justify-center rounded-full border text-[10px] " +
                      (selected
                        ? "border-realtor-primary bg-realtor-primary text-white"
                        : "border-realtor-primary/25 text-realtor-muted/70")
                    }
                  >
                    {selected ? "✓" : "+"}
                  </span>
                  {option.label}
                </span>
                <span className="mt-1 block pl-7 text-xs leading-relaxed text-realtor-muted">
                  {option.helper}
                </span>
              </button>
            );
          })}
        </div>

        <label className="mt-4 block">
          <span className="text-xs font-medium uppercase tracking-wider text-realtor-muted">
            Specific shot notes (optional)
          </span>
          <textarea
            rows={3}
            value={shootNotes}
            onChange={(e) => setShootNotes(e.currentTarget.value)}
            placeholder="Example: Please highlight the new kitchen, backyard pergola, and the view from the primary bedroom."
            className="realtor-field mt-1 w-full rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-light/60"
          />
        </label>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-realtor-primary/10 pt-5">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-full border border-realtor-primary/20 px-4 py-2 text-sm text-realtor-muted transition hover:border-realtor-primary/35 hover:bg-realtor-surface"
        >
          ← Back
        </button>
        <button
          type="submit"
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-realtor-primary/20 transition hover:bg-brand-light"
        >
          Continue →
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
  value,
  onChange,
  error,
  helper,
  inputMode,
  min,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  helper?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  min?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wider text-realtor-muted">
        {label}
        {required ? <span className="text-brand-light"> *</span> : null}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        inputMode={inputMode}
        min={min}
        className={
          "realtor-field mt-1 w-full rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-light/60 " +
          (error ? "border-red-400/60" : "border-realtor-primary/15")
        }
      />
      {helper ? (
        <span className="mt-1 block text-[11px] leading-relaxed text-realtor-muted">
          {helper}
        </span>
      ) : null}
      {error ? (
        <span className="mt-1 block text-xs text-red-300">{error}</span>
      ) : null}
    </label>
  );
}

function RadioCard<T extends string>({
  name,
  value,
  label,
  helper,
  current,
  onSelect,
}: {
  name: string;
  value: T;
  label: string;
  helper: string;
  current: string;
  onSelect: (v: T) => void;
}) {
  const selected = current === value;
  return (
    <label
      className={
        "flex cursor-pointer items-start gap-3 rounded-2xl p-3 transition " +
        (selected
          ? "realtor-choice-selected"
          : "realtor-choice hover:border-brand/60")
      }
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={selected}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold transition " +
          (selected
            ? "border-realtor-primary bg-realtor-primary text-white"
            : "border-realtor-primary/25 bg-realtor-surface text-transparent")
        }
      >
        ✓
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-realtor-text">
          {label}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-realtor-muted">
          {helper}
        </span>
      </span>
    </label>
  );
}
