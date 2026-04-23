"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Google Places address autocomplete.
 *
 * Loads the Maps JavaScript SDK + Places library on first mount, then
 * wires `google.maps.places.Autocomplete` to the input below. When the
 * user picks a prediction:
 *
 *   - We parse the `address_components` into street / unit / city /
 *     postal_code and emit them to the parent via `onPlace`.
 *   - The input itself keeps the formatted address for visual confirmation.
 *
 * Falls back gracefully:
 *   - No `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` → the component renders as a
 *     plain text input and just emits the raw typed value.
 *   - Script fails to load (offline, API quota, etc.) → same fallback.
 *
 * Canadian-only for now (`country: ["ca"]`). Most realtors search in the
 * GTA; US addresses would require changing this or adding a setting.
 */

export interface PlaceParts {
  /** Street number + street name, e.g. "123 King St W". */
  street_address: string;
  /** Suite / unit / apt, if the user picked a Premise + subpremise. */
  unit_number: string;
  city: string;
  province: string;
  postal_code: string;
  /** The address as Google formatted it — useful for debugging / fallback. */
  formatted_address: string;
}

interface Props {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  /** Initial displayed value — use when pre-filling on step revisit. */
  defaultValue?: string;
  /** Fires when the user picks an autocomplete suggestion. */
  onPlace: (parts: PlaceParts) => void;
  /** Fires on plain typing (for two-way controlled usage). */
  onChange?: (value: string) => void;
  error?: string;
}

// Module-level so repeated mounts don't re-inject the <script>.
let loaderPromise: Promise<void> | null = null;

function loadPlacesSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (loaderPromise) return loaderPromise;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return Promise.reject(
      new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY not set"),
    );
  }
  // Global cached between Autocomplete mounts.
  const win = window as unknown as { google?: { maps?: { places?: unknown } } };
  if (win.google?.maps?.places) {
    return Promise.resolve();
  }

  loaderPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("google-maps-sdk");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Google Maps SDK failed to load")),
      );
      return;
    }
    const s = document.createElement("script");
    s.id = "google-maps-sdk";
    s.async = true;
    s.defer = true;
    s.src =
      "https://maps.googleapis.com/maps/api/js?" +
      new URLSearchParams({
        key: apiKey,
        libraries: "places",
        loading: "async",
        v: "weekly",
      }).toString();
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Google Maps SDK failed to load"));
    document.head.appendChild(s);
  });
  return loaderPromise;
}

export default function AddressAutocomplete({
  name,
  label,
  required,
  placeholder,
  defaultValue,
  onPlace,
  onChange,
  error,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<unknown>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    let cancelled = false;
    loadPlacesSdk()
      .then(() => {
        if (cancelled) return;
        setSdkReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setSdkError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sdkReady || !inputRef.current) return;
    const win = window as unknown as {
      google: {
        maps: {
          places: {
            Autocomplete: new (
              input: HTMLInputElement,
              options: unknown,
            ) => {
              addListener: (event: string, cb: () => void) => void;
              getPlace: () => {
                address_components?: Array<{
                  long_name: string;
                  short_name: string;
                  types: string[];
                }>;
                formatted_address?: string;
              };
            };
          };
        };
      };
    };
    const ac = new win.google.maps.places.Autocomplete(inputRef.current, {
      types: ["address"],
      componentRestrictions: { country: ["ca"] },
      fields: ["address_components", "formatted_address"],
    });
    autocompleteRef.current = ac;

    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      const parts = parseAddressComponents(
        place.address_components ?? [],
        place.formatted_address ?? "",
      );
      onPlace(parts);
      if (inputRef.current && place.formatted_address) {
        inputRef.current.value = place.formatted_address;
        onChange?.(place.formatted_address);
      }
    });

    return () => {
      // Detach listener on unmount; Google doesn't expose a clean API
      // for this but dropping the ref + the old input is enough since
      // the event fires against the input node.
      autocompleteRef.current = null;
    };
  }, [sdkReady, onPlace, onChange]);

  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
        {label}
        {required ? <span className="text-brand-light"> *</span> : null}
      </span>
      <input
        id={inputId}
        ref={inputRef}
        name={name}
        type="text"
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        autoComplete="off"
        onChange={(e) => onChange?.(e.currentTarget.value)}
        className={
          "mt-1 w-full rounded-md border bg-ink-soft px-3 py-2 text-white placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-light/60 " +
          (error ? "border-red-400/60" : "border-white/10")
        }
      />
      <span className="mt-1 block text-[11px] text-ink-muted">
        {sdkError
          ? "Autocomplete offline — just type the address manually."
          : sdkReady
            ? "Start typing — we'll suggest full addresses."
            : "Loading suggestions…"}
      </span>
      {error ? (
        <span className="mt-1 block text-xs text-red-300">{error}</span>
      ) : null}
    </label>
  );
}

function parseAddressComponents(
  components: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>,
  formatted_address: string,
): PlaceParts {
  let streetNumber = "";
  let route = "";
  let unit = "";
  let city = "";
  let province = "";
  let postal_code = "";

  for (const c of components) {
    if (c.types.includes("street_number")) streetNumber = c.long_name;
    else if (c.types.includes("route")) route = c.long_name;
    else if (c.types.includes("subpremise")) unit = c.long_name;
    else if (c.types.includes("postal_town")) city = c.long_name;
    else if (c.types.includes("locality")) city = c.long_name || city;
    else if (c.types.includes("administrative_area_level_3") && !city) {
      city = c.long_name;
    } else if (c.types.includes("sublocality") && !city) {
      // Some Toronto addresses come through as sublocalities
      city = c.long_name;
    } else if (c.types.includes("administrative_area_level_1")) {
      province = c.short_name;
    } else if (c.types.includes("postal_code")) postal_code = c.long_name;
  }

  const street_address = [streetNumber, route].filter(Boolean).join(" ").trim();

  return {
    street_address,
    unit_number: unit,
    city,
    province,
    postal_code,
    formatted_address,
  };
}
