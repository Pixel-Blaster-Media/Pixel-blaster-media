"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import AddressAutocomplete, {
  type PlaceParts,
} from "@/app/_components/AddressAutocomplete";
import type { VacancyState } from "@/lib/booking/wizard-state";

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
    // Dropping an old slot — if they edit property details, the time
    // may no longer make sense for the new service duration anyway.
    out.delete("slot");

    router.push(`/book/schedule?${out.toString()}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
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

      <div className="grid gap-4 md:grid-cols-2">
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
        />
      </div>

      <fieldset>
        <legend className="text-xs font-medium uppercase tracking-wider text-ink-muted">
          Is the property occupied?
        </legend>
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

      <fieldset>
        <legend className="text-xs font-medium uppercase tracking-wider text-ink-muted">
          Include basement in the shoot?
        </legend>
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

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-5">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-white/15 px-4 py-2 text-sm text-white/80 hover:border-white/30"
        >
          ← Back
        </button>
        <button
          type="submit"
          className="rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-light"
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
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  min?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
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
          "mt-1 w-full rounded-md border bg-ink-soft px-3 py-2 text-white placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-light/60 " +
          (error ? "border-red-400/60" : "border-white/10")
        }
      />
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
        "flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition " +
        (selected
          ? "border-brand-light bg-brand/10"
          : "border-white/10 hover:border-brand/60")
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
      <span className="text-sm font-semibold text-white">{label}</span>
      <span className="text-xs text-ink-muted">{helper}</span>
    </label>
  );
}
