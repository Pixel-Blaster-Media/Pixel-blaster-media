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
        className="grid gap-3 rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-4 shadow-sm shadow-realtor-text/5 md:grid-cols-[1fr_1fr] xl:grid-cols-[1fr_1fr_1fr_auto]"
      >
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-realtor-muted">
            Starts
          </span>
          <input
            type="datetime-local"
            name="starts_at"
            required
            className="mt-1 box-border w-full min-w-0 rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text outline-none [color-scheme:light] focus:border-realtor-primary/45"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-realtor-muted">
            Ends
          </span>
          <input
            type="datetime-local"
            name="ends_at"
            required
            className="mt-1 box-border w-full min-w-0 rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text outline-none [color-scheme:light] focus:border-realtor-primary/45"
          />
        </label>
        <label className="block md:col-span-2 xl:col-span-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-realtor-muted">
            Label (private)
          </span>
          <input
            type="text"
            name="label"
            placeholder="Vacation / Family / etc."
            className="mt-1 box-border w-full min-w-0 rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text outline-none placeholder:text-realtor-muted/70 focus:border-realtor-primary/45"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="self-end rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-realtor-primary/90 disabled:opacity-50 md:w-fit"
        >
          {pending ? "Adding…" : "Add block"}
        </button>
        {error ? (
          <p className="text-xs text-red-700 md:col-span-2 xl:col-span-4" role="alert">
            {error}
          </p>
        ) : null}
      </form>

      {blocks.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-realtor-primary/20 bg-realtor-surface/70 p-5 text-center text-sm text-realtor-muted">
          No upcoming blocks.
        </p>
      ) : (
        <ul className="space-y-2">
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
    <li className="flex items-center justify-between gap-3 rounded-2xl border border-realtor-primary/15 bg-realtor-surface/80 p-3 shadow-sm shadow-realtor-text/5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-realtor-text">
          {fmt.format(new Date(block.starts_at))} →{" "}
          {fmt.format(new Date(block.ends_at))}
        </p>
        {block.label ? (
          <p className="truncate text-xs text-realtor-muted">{block.label}</p>
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
        className="shrink-0 rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "…" : "Delete"}
      </button>
    </li>
  );
}
