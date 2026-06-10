"use client";

import { useState, useTransition } from "react";

import { createInvoice, refreshInvoice } from "./actions";

interface InvoiceState {
  id: string | null;
  number: string | null;
  url: string | null;
  status: string | null;
  totalCents: number | null;
  syncedAt: string | null;
}

export default function InvoiceSection({
  bookingId,
  initial,
}: {
  bookingId: string;
  initial: InvoiceState;
}) {
  const [state, setState] = useState<InvoiceState>(initial);
  const [pending, startPending] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onCreate() {
    setError(null);
    startPending(async () => {
      const res = await createInvoice(bookingId);
      if (!res.ok) {
        setError(res.error ?? "Create failed.");
        return;
      }
      setState((s) => ({
        ...s,
        id: s.id, // the action's result doesn't echo the id; page will revalidate
        url: res.invoiceUrl ?? s.url,
        number: res.invoiceNumber ?? s.number,
        totalCents: res.totalCents ?? s.totalCents,
        syncedAt: new Date().toISOString(),
      }));
    });
  }

  function onRefresh() {
    setError(null);
    startPending(async () => {
      const res = await refreshInvoice(bookingId);
      if (!res.ok) {
        setError(res.error ?? "Refresh failed.");
        return;
      }
      setState((s) => ({
        ...s,
        status: res.status ?? s.status,
        syncedAt: new Date().toISOString(),
      }));
    });
  }

  const hasInvoice = !!state.id || !!initial.id;

  return (
    <div className="space-y-4 rounded-2xl border border-realtor-primary/20 bg-realtor-primary/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-realtor-primary">
            Invoice
          </h2>
          <p className="mt-1 text-xs text-realtor-muted">
            Created in QuickBooks using the prices in /admin/settings/pricing.
            Re-running is a no-op if an invoice already exists.
          </p>
        </div>
        {hasInvoice ? (
          <StatusPill status={state.status ?? "open"} />
        ) : (
          <span className="rounded-full border border-realtor-primary/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-realtor-muted">
            Not invoiced
          </span>
        )}
      </div>

      {hasInvoice ? (
        <dl className="grid gap-y-1 text-sm md:grid-cols-[140px_1fr]">
          {state.number || initial.number ? (
            <>
              <dt className="text-realtor-muted">Invoice #</dt>
              <dd className="text-realtor-text">{state.number ?? initial.number}</dd>
            </>
          ) : null}
          {(state.totalCents ?? initial.totalCents) != null ? (
            <>
              <dt className="text-realtor-muted">Total</dt>
              <dd className="text-realtor-text">
                ${(
                  ((state.totalCents ?? initial.totalCents) as number) / 100
                ).toFixed(2)}
              </dd>
            </>
          ) : null}
          {(state.syncedAt ?? initial.syncedAt) ? (
            <>
              <dt className="text-realtor-muted">Last synced</dt>
              <dd className="text-realtor-text">
                {new Date(
                  (state.syncedAt ?? initial.syncedAt) as string,
                ).toLocaleString()}
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        {!hasInvoice ? (
          <button
            type="button"
            onClick={onCreate}
            disabled={pending}
            className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white hover:bg-realtor-primary/90 disabled:opacity-60"
          >
            {pending ? "Creating…" : "Create invoice"}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onRefresh}
              disabled={pending}
              className="rounded-full border border-realtor-primary/20 px-3 py-2 text-sm text-realtor-text hover:border-realtor-primary/40 hover:text-realtor-primary disabled:opacity-60"
            >
              {pending ? "Refreshing…" : "Refresh status"}
            </button>
            {(state.url ?? initial.url) ? (
              <a
                href={(state.url ?? initial.url) as string}
                target="_blank"
                rel="noopener"
                className="rounded-full border border-realtor-primary/40 px-3 py-2 text-sm font-semibold text-realtor-primary hover:border-realtor-primary/40 hover:bg-realtor-primary/10"
              >
                Open in QuickBooks ↗
              </a>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const className =
    normalized === "paid"
      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
      : normalized === "void"
        ? "border-red-300 bg-red-50 text-red-700"
        : "border-amber-300 bg-amber-50 text-amber-800";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${className}`}
    >
      {normalized === "paid" ? "Paid" : normalized === "void" ? "Void" : "Open"}
    </span>
  );
}
