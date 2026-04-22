"use client";

import { useState, useTransition } from "react";

import type { CatalogItemKind } from "@/lib/supabase/database.types";

import { createCatalogItem } from "./actions";

export default function NewItemForm({ kind }: { kind: CatalogItemKind }) {
  const [pending, startPending] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-semibold uppercase tracking-wider text-brand-light hover:text-white"
        >
          + Add {kind === "addon" ? "add-on" : kind === "bundle" ? "bundle" : "a-la-carte item"}
        </button>
      </div>
    );
  }

  const isAddon = kind === "addon";

  return (
    <form
      action={(fd) => {
        setError(null);
        startPending(async () => {
          const res = await createCatalogItem(fd);
          if (!res.ok) setError(res.error ?? "Create failed.");
          else {
            setOpen(false);
            // The revalidatePath in the action refreshes the server component
            // list, so the new item appears without a page reload.
          }
        });
      }}
      className="space-y-3 rounded-md border border-white/10 bg-ink-soft/70 p-4"
    >
      <input type="hidden" name="kind" value={kind} />

      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-muted">
            Name
          </span>
          <input
            name="name"
            required
            placeholder={isAddon ? "Twilight exterior" : "The Blue Print"}
            className="rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-sm text-white"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-muted">
            Price
          </span>
          <div className="flex items-center gap-1">
            <span className="text-xs text-ink-muted">$</span>
            <input
              name="price_dollars"
              type="number"
              min={0}
              step="0.01"
              defaultValue="0"
              className="w-24 rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-right text-sm text-white"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-muted">
            Duration
          </span>
          <div className="flex items-center gap-1">
            <input
              name="duration_minutes"
              type="number"
              min={0}
              step="1"
              defaultValue="0"
              className="w-20 rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-right text-sm text-white"
            />
            <span className="text-xs text-ink-muted">min</span>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-muted">
            Order
          </span>
          <input
            name="display_order"
            type="number"
            min={0}
            step="1"
            defaultValue="100"
            className="w-16 rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-right text-sm text-white"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-ink-muted">
          Description
        </span>
        <textarea
          name="description"
          rows={3}
          placeholder="- Up to 50 Photos&#10;- iGuide Virtual Tour&#10;- Floor plans"
          className="w-full rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-sm text-white"
        />
      </label>

      <div className="flex flex-wrap items-center gap-4 text-xs text-ink-muted">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="active"
            defaultChecked
            className="h-4 w-4 accent-brand-light"
          />
          <span>Active</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="taxable"
            defaultChecked
            className="h-4 w-4 accent-brand-light"
          />
          <span>Taxable</span>
        </label>
        {isAddon ? (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="require_has_video"
              className="h-4 w-4 accent-brand-light"
            />
            <span>Only when cart has video</span>
          </label>
        ) : (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="is_video"
              className="h-4 w-4 accent-brand-light"
            />
            <span>Counts as video</span>
          </label>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-light disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add item"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white hover:border-white/30"
        >
          Cancel
        </button>
        {error ? (
          <p role="alert" className="text-xs text-red-300">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
