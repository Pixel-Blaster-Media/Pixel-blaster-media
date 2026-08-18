"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import AddressAutocomplete, {
  type PlaceParts,
} from "@/app/_components/AddressAutocomplete";
import { updateBookingDetails } from "./actions";

export interface EditCatalogItem {
  id: string;
  kind: "bundle" | "a_la_carte" | "addon";
  name: string;
  slug: string;
  durationMinutes: number;
  priceCents: number;
}

export interface EditableBookingInitial {
  scheduledAtLocal: string;
  streetAddress: string;
  unitNumber: string;
  city: string;
  province: string;
  postalCode: string;
  squareFootage: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  brokerage: string;
  clientNotes: string;
  internalNotes: string;
  selectedCatalogItemIds: string[];
}

export default function EditBookingForm({
  bookingId,
  initial,
  catalogItems,
}: {
  bookingId: string;
  initial: EditableBookingInitial;
  catalogItems: EditCatalogItem[];
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [property, setProperty] = useState({
    street_address: initial.streetAddress,
    unit_number: initial.unitNumber,
    city: initial.city,
    province: initial.province || "ON",
    postal_code: initial.postalCode,
  });

  function applyPlace(parts: PlaceParts) {
    setProperty({
      street_address: parts.street_address || property.street_address,
      unit_number: parts.unit_number || property.unit_number,
      city: parts.city || property.city,
      province: parts.province || property.province || "ON",
      postal_code: parts.postal_code || property.postal_code,
    });
  }

  function onSubmit(formData: FormData) {
    setError(null);
    setSavedMessage(null);
    startTransition(async () => {
      const result = await updateBookingDetails(bookingId, formData);
      if (!result.ok) {
        setError(result.error ?? "Could not save booking.");
        return;
      }
      setSavedMessage(
        result.confirmationSent
          ? "Booking saved and confirmation email sent."
          : "Booking saved.",
      );
      router.refresh();
    });
  }

  const bundles = catalogItems.filter((item) => item.kind === "bundle");
  const aLaCarte = catalogItems.filter((item) => item.kind === "a_la_carte");
  const addons = catalogItems.filter((item) => item.kind === "addon");

  return (
    <form action={onSubmit} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Date and time">
          <input
            name="scheduled_at"
            type="datetime-local"
            defaultValue={initial.scheduledAtLocal}
            className={inputClass}
          />
        </Field>
        <Field label="Realtor email">
          <input
            type="email"
            value={initial.contactEmail}
            readOnly
            className={`${inputClass} cursor-not-allowed opacity-70`}
          />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Realtor name">
          <input
            name="contact_name"
            defaultValue={initial.contactName}
            required
            className={inputClass}
          />
        </Field>
        <Field label="Phone">
          <input
            name="contact_phone"
            defaultValue={initial.contactPhone}
            className={inputClass}
          />
        </Field>
        <Field label="Brokerage">
          <input
            name="brokerage"
            defaultValue={initial.brokerage}
            className={inputClass}
          />
        </Field>
        <Field label="Square footage">
          <input
            name="square_footage"
            type="number"
            min="0"
            step="1"
            defaultValue={initial.squareFootage}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <AddressAutocomplete
          name="street_address"
          label="Address"
          required
          defaultValue={property.street_address}
          placeholder="89 Barons Ave"
          onChange={(value) =>
            setProperty((current) => ({ ...current, street_address: value }))
          }
          onPlace={applyPlace}
        />
        <Field label="Unit">
          <input
            name="unit_number"
            value={property.unit_number}
            onChange={(event) =>
              setProperty((current) => ({
                ...current,
                unit_number: event.target.value,
              }))
            }
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Field label="City">
          <input
            name="city"
            value={property.city}
            onChange={(event) =>
              setProperty((current) => ({ ...current, city: event.target.value }))
            }
            className={inputClass}
          />
        </Field>
        <Field label="Province">
          <input
            name="province"
            value={property.province}
            onChange={(event) =>
              setProperty((current) => ({
                ...current,
                province: event.target.value,
              }))
            }
            className={inputClass}
          />
        </Field>
        <Field label="Postal code">
          <input
            name="postal_code"
            value={property.postal_code}
            onChange={(event) =>
              setProperty((current) => ({
                ...current,
                postal_code: event.target.value,
              }))
            }
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <CatalogGroup
          title="Packages"
          items={bundles}
          selected={initial.selectedCatalogItemIds}
        />
        <CatalogGroup
          title="A la carte"
          items={aLaCarte}
          selected={initial.selectedCatalogItemIds}
        />
        <CatalogGroup
          title="Add-ons"
          items={addons}
          selected={initial.selectedCatalogItemIds}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Realtor notes">
          <textarea
            name="client_notes"
            defaultValue={initial.clientNotes}
            rows={4}
            className={inputClass}
          />
        </Field>
        <Field label="Internal notes">
          <textarea
            name="internal_notes"
            defaultValue={initial.internalNotes}
            rows={4}
            className={inputClass}
          />
        </Field>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-realtor-primary/15 bg-white/70 p-3 text-sm text-realtor-text">
        <input
          name="send_confirmation"
          type="checkbox"
          defaultChecked
          className="mt-1"
        />
        <span>
          <span className="block font-semibold">
            Email the booking update to the realtor
          </span>
          <span className="block text-xs text-realtor-muted">
            Turn this off only for a quiet internal correction.
          </span>
        </span>
      </label>

      {error ? (
        <p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {savedMessage ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {savedMessage}
        </p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-realtor-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Saving..." : "Save booking"}
        </button>
      </div>
    </form>
  );
}

function CatalogGroup({
  title,
  items,
  selected,
}: {
  title: string;
  items: EditCatalogItem[];
  selected: string[];
}) {
  return (
    <fieldset className="rounded-xl border border-realtor-primary/15 bg-white/65 p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-realtor-primary/80">
        {title}
      </legend>
      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <label
            key={item.id}
            className="flex items-start gap-2 rounded-lg border border-realtor-primary/10 bg-realtor-surface/85 px-2 py-2 text-sm text-realtor-text"
          >
            <input
              name="catalog_item_id"
              type="checkbox"
              value={item.id}
              defaultChecked={selected.includes(item.id)}
              className="mt-1"
            />
            <span className="min-w-0">
              <span className="block font-semibold">{item.name}</span>
              <span className="block text-xs text-realtor-muted">
                {formatDuration(item.durationMinutes)} · {formatPrice(item.priceCents)}
              </span>
            </span>
          </label>
        ))}
        {items.length === 0 ? (
          <p className="text-xs text-realtor-muted">No active items.</p>
        ) : null}
      </div>
    </fieldset>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wider text-realtor-muted">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0 ? `${hours} hr` : `${hours} hr ${remaining} min`;
}

const inputClass =
  "w-full rounded-md border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-realtor-text placeholder-realtor-muted focus:outline-none focus:ring-2 focus:ring-realtor-primary/60";
