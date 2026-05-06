"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

/**
 * Address autocomplete backed by Places API (New) REST.
 *
 * Why not the classic `google.maps.places.Autocomplete` widget? Google
 * disabled that constructor for API keys created after 2025-03-01, so
 * any fresh key returns an empty `places` object and the widget
 * errors "Cannot read properties of undefined (reading 'Autocomplete')".
 *
 * Why not the newer `PlaceAutocompleteElement` Web Component? Its
 * built-in dropdown can't be styled to match our dark theme — the
 * shadow-DOM parts are limited, and we'd still need the Maps JS SDK
 * loaded (which also tends to fail with InvalidKeyMapError on freshly-
 * issued keys while restrictions propagate).
 *
 * So this component talks directly to
 *   POST https://places.googleapis.com/v1/places:autocomplete
 *   GET  https://places.googleapis.com/v1/places/{placeId}
 *
 * and renders our own styled suggestion list. Only dep is a public API
 * key with Places API (New) enabled and the browser's origin whitelisted
 * as an HTTP referrer.
 *
 * Falls back to a plain text input whenever anything fails — the user
 * can always type an address manually, and step-2 validation only
 * requires street + city.
 */

export interface PlaceParts {
  street_address: string;
  unit_number: string;
  city: string;
  province: string;
  postal_code: string;
  formatted_address: string;
}

interface Props {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  /** Pre-fill when the user revisits step 2 from a later step. */
  defaultValue?: string;
  /** Fires when the user picks a suggestion. */
  onPlace: (parts: PlaceParts) => void;
  /** Fires on plain typing so the parent can stay in sync. */
  onChange?: (value: string) => void;
  error?: string;
}

type Suggestion = {
  placeId: string;
  text: string;
};

type AutocompleteStatus =
  | "idle"
  | "ok"
  | "auth_error"
  | "quota_error"
  | "network_error";

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 250;

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
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const containerRef = useRef<HTMLDivElement>(null);

  // Fully controlled: the input's value is `value`, which either the
  // user types or we set from a suggestion click. This avoids the
  // "re-render steals focus / resets DOM value" class of bugs.
  const [value, setValue] = useState(defaultValue ?? "");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [status, setStatus] = useState<AutocompleteStatus>("idle");

  // One session token per "typing session" so Google bills a session
  // (autocomplete + details) as a single billable event per their docs.
  const [sessionToken, setSessionToken] = useState<string>(() =>
    crypto.randomUUID(),
  );

  // Stash callbacks in refs so we don't have to include them in effect
  // deps (keeps the debounce effect from thrashing on every parent
  // re-render).
  const onPlaceRef = useRef(onPlace);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onPlaceRef.current = onPlace;
  }, [onPlace]);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const keyProblem = getKeyProblem(apiKey);

  // Debounced suggestion fetch.
  useEffect(() => {
    if (keyProblem || !apiKey) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }
    const q = value.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          "https://places.googleapis.com/v1/places:autocomplete",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": apiKey,
            },
            body: JSON.stringify({
              input: q,
              includedRegionCodes: ["ca"],
              sessionToken,
            }),
            signal: controller.signal,
          },
        );
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) setStatus("auth_error");
          else if (res.status === 429) setStatus("quota_error");
          else setStatus("network_error");
          setSuggestions([]);
          setIsOpen(false);
          return;
        }
        const data = (await res.json()) as {
          suggestions?: Array<{
            placePrediction?: {
              placeId: string;
              text?: { text?: string };
            };
          }>;
        };
        const next: Suggestion[] = [];
        for (const s of data.suggestions ?? []) {
          const p = s.placePrediction;
          if (!p?.placeId || !p.text?.text) continue;
          next.push({ placeId: p.placeId, text: p.text.text });
        }
        setSuggestions(next);
        setIsOpen(next.length > 0);
        setHighlighted(-1);
        setStatus("ok");
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setStatus("network_error");
        setSuggestions([]);
        setIsOpen(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, apiKey, sessionToken, keyProblem]);

  // Click outside → close the dropdown.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const pickPlace = useCallback(
    async (suggestion: Suggestion) => {
      setIsOpen(false);
      setValue(suggestion.text);
      onChangeRef.current?.(suggestion.text);
      if (!apiKey) return;
      try {
        const res = await fetch(
          `https://places.googleapis.com/v1/places/${encodeURIComponent(
            suggestion.placeId,
          )}?sessionToken=${encodeURIComponent(sessionToken)}`,
          {
            headers: {
              "X-Goog-Api-Key": apiKey,
              "X-Goog-FieldMask": "addressComponents,formattedAddress",
            },
          },
        );
        if (!res.ok) return;
        const place = (await res.json()) as {
          formattedAddress?: string;
          addressComponents?: Array<{
            longText?: string;
            shortText?: string;
            types?: string[];
          }>;
        };
        const parts = parsePlace(place);
        // Display just the street line in the input — city / postal go
        // into their own fields. Keeps each piece editable.
        const display = parts.street_address || parts.formatted_address || suggestion.text;
        setValue(display);
        onChangeRef.current?.(display);
        onPlaceRef.current(parts);
      } finally {
        // Rotate the session token — Google's pricing treats one
        // autocomplete+details pair as a single session.
        setSessionToken(crypto.randomUUID());
      }
    },
    [apiKey, sessionToken],
  );

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted(
        (h) => (h - 1 + suggestions.length) % suggestions.length,
      );
    } else if (e.key === "Enter" && highlighted >= 0) {
      e.preventDefault();
      void pickPlace(suggestions[highlighted]);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  }

  function onType(e: ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setValue(v);
    onChangeRef.current?.(v);
    if (!isOpen && v.length >= MIN_QUERY_LENGTH) setIsOpen(true);
  }

  const helperText = helperForStatus({
    keyProblem,
    status,
    valueLength: value.length,
    suggestionCount: suggestions.length,
  });

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={inputId} className="block">
        <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
          {label}
          {required ? <span className="text-brand-light"> *</span> : null}
        </span>
        <input
          id={inputId}
          name={name}
          type="text"
          required={required}
          placeholder={placeholder}
          value={value}
          onChange={onType}
          onKeyDown={onKeyDown}
          onFocus={() => suggestions.length > 0 && setIsOpen(true)}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          className={
            "mt-1 w-full rounded-md border bg-ink-soft px-3 py-2 text-white placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-light/60 " +
            (error ? "border-red-400/60" : "border-white/10")
          }
        />
        <span className="mt-1 block text-[11px] text-ink-muted">
          {helperText}
        </span>
        {error ? (
          <span className="mt-1 block text-xs text-red-300">{error}</span>
        ) : null}
      </label>
      {isOpen && suggestions.length > 0 ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border border-white/10 bg-ink shadow-xl"
        >
          {suggestions.map((s, i) => (
            <li key={s.placeId} role="option" aria-selected={i === highlighted}>
              <button
                type="button"
                onMouseDown={(e) => {
                  // onMouseDown (not onClick) so focus doesn't move to
                  // the button before we process the pick — otherwise
                  // the outside-click handler fires first and closes.
                  e.preventDefault();
                  void pickPlace(s);
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={
                  "block w-full px-3 py-2 text-left text-sm transition " +
                  (i === highlighted
                    ? "bg-brand/15 text-white"
                    : "text-white/90 hover:bg-white/5")
                }
              >
                {s.text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function parsePlace(place: {
  formattedAddress?: string;
  addressComponents?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
}): PlaceParts {
  let streetNumber = "";
  let route = "";
  let unit = "";
  let city = "";
  let province = "";
  let postal_code = "";

  for (const c of place.addressComponents ?? []) {
    const types = c.types ?? [];
    const long = c.longText ?? "";
    const short = c.shortText ?? "";
    if (types.includes("street_number")) streetNumber = long;
    else if (types.includes("route")) route = long;
    else if (types.includes("subpremise")) unit = long;
    else if (types.includes("postal_town")) city = long;
    else if (types.includes("locality")) city = long || city;
    else if (types.includes("administrative_area_level_3") && !city) {
      city = long;
    } else if (types.includes("sublocality") && !city) {
      city = long;
    } else if (types.includes("administrative_area_level_1")) {
      province = short;
    } else if (types.includes("postal_code")) postal_code = long;
  }

  const street_address = [streetNumber, route]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    street_address,
    unit_number: unit,
    city,
    province,
    postal_code,
    formatted_address: place.formattedAddress ?? street_address,
  };
}

function getKeyProblem(apiKey: string | undefined): "missing" | "invalid" | null {
  if (!apiKey) return "missing";
  if (!/^[\x20-\x7E]+$/.test(apiKey)) return "invalid";
  if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(apiKey)) return "invalid";
  return null;
}

function helperForStatus(args: {
  keyProblem: "missing" | "invalid" | null;
  status: AutocompleteStatus;
  valueLength: number;
  suggestionCount: number;
}): string {
  if (args.keyProblem === "missing") {
    return "Address suggestions are not configured yet — type manually.";
  }
  if (args.keyProblem === "invalid") {
    return "Address suggestions need a clean Google Places browser key — type manually.";
  }
  if (args.status === "auth_error") {
    return "Google Places is blocked by key/API/referrer settings — type manually.";
  }
  if (args.status === "quota_error") {
    return "Google Places quota or billing needs attention — type manually.";
  }
  if (args.status === "network_error") {
    return "Autocomplete is offline right now — type manually.";
  }
  if (args.valueLength < MIN_QUERY_LENGTH) {
    return "Start typing — we'll suggest full addresses.";
  }
  if (args.status === "ok" && args.suggestionCount === 0) {
    return "No address matches found.";
  }
  return "Pick a suggestion or keep typing.";
}
