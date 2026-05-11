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
        <span className="text-xs font-medium uppercase tracking-wider text-realtor-muted">
          Default service item
        </span>
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setSaved(false);
          }}
          className="admin-input mt-1"
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
        className="rounded-full border border-realtor-primary/20 bg-white px-3 py-2 text-sm font-semibold text-realtor-primary hover:border-realtor-primary/40 hover:bg-realtor-primary/5 disabled:opacity-50"
      >
        {pending ? "Saving…" : saved ? "✓ Saved" : "Save"}
      </button>
      {error ? (
        <p role="alert" className="w-full text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
