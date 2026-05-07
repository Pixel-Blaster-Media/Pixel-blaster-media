"use client";

import { useState, useTransition } from "react";

import { addCalendarBlock, deleteCalendarBlock } from "./actions";

interface Block {
  id: string;
  starts_at: string;
  ends_at: string;
  label: string | null;
}

export default function BlocksManager({ blocks }: { blocks: Block[] }) {
  const [pending, startPending] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <form
        action={(fd) => {
          setError(null);
          startPending(async () => {
            const res = await addCalendarBlock(fd);
            if (!res.ok) setError(res.error ?? "Add failed.");
            else
              (document.getElementById("block-form") as HTMLFormElement | null)?.reset();
          });
        }}
        id="block-form"
        className="grid gap-2 rounded-2xl border border-white/10 bg-ink-soft/50 p-4 md:grid-cols-[1fr_1fr_1fr_auto]"
      >
        <label className="block">
          <span className="text-xs text-ink-muted">Starts</span>
          <input
            type="datetime-local"
            name="starts_at"
            required
            className="mt-1 w-full rounded-xl border border-white/10 bg-ink px-2 py-1.5 text-sm text-white"
          />
        </label>
        <label className="block">
          <span className="text-xs text-ink-muted">Ends</span>
          <input
            type="datetime-local"
            name="ends_at"
            required
            className="mt-1 w-full rounded-xl border border-white/10 bg-ink px-2 py-1.5 text-sm text-white"
          />
        </label>
        <label className="block">
          <span className="text-xs text-ink-muted">Label (private)</span>
          <input
            type="text"
            name="label"
            placeholder="Vacation / Family / etc."
            className="mt-1 w-full rounded-xl border border-white/10 bg-ink px-2 py-1.5 text-sm text-white"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="self-end rounded-full bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add block"}
        </button>
        {error ? (
          <p className="md:col-span-4 text-xs text-red-300" role="alert">
            {error}
          </p>
        ) : null}
      </form>

      {blocks.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/10 bg-ink-soft/40 p-4 text-center text-xs text-ink-muted">
          No upcoming blocks.
        </p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-ink-soft/50">
          {blocks.map((b) => (
            <BlockRow key={b.id} block={b} />
          ))}
        </ul>
      )}
    </div>
  );
}

function BlockRow({ block }: { block: Block }) {
  const [pending, startPending] = useTransition();
  const fmt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <li className="flex items-center justify-between gap-3 p-3">
      <div className="min-w-0">
        <p className="text-sm text-white">
          {fmt.format(new Date(block.starts_at))} →{" "}
          {fmt.format(new Date(block.ends_at))}
        </p>
        {block.label ? (
          <p className="truncate text-xs text-ink-muted">{block.label}</p>
        ) : null}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm("Delete this block?")) return;
          startPending(async () => {
            await deleteCalendarBlock(block.id);
          });
        }}
        className="text-xs text-red-300 hover:text-red-200 disabled:opacity-50"
      >
        {pending ? "…" : "Delete"}
      </button>
    </li>
  );
}
