"use client";

import { useState, useTransition } from "react";

import { setDefaultItem } from "./actions";

interface Item {
  Id: string;
  Name: string;
}

export default function ItemPicker({
  items,
  currentItemId,
}: {
  items: Item[];
  currentItemId: string | null;
}) {
  const [selected, setSelected] = useState(currentItemId ?? "");
  const [pending, startPending] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex-1">
        <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
          Default service item
        </span>
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setSaved(false);
          }}
          className="mt-1 w-full rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-sm text-white"
        >
          <option value="" disabled>
            Pick one…
          </option>
          {items.map((i) => (
            <option key={i.Id} value={i.Id}>
              {i.Name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={pending || !selected || selected === currentItemId}
        onClick={() => {
          setError(null);
          setSaved(false);
          startPending(async () => {
            const res = await setDefaultItem(selected);
            if (!res.ok) setError(res.error ?? "Save failed.");
            else setSaved(true);
          });
        }}
        className="rounded-md border border-white/15 px-3 py-2 text-sm text-white hover:border-brand-light hover:text-brand-light disabled:opacity-50"
      >
        {pending ? "Saving…" : saved ? "✓ Saved" : "Save"}
      </button>
      {error ? (
        <p role="alert" className="w-full text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
