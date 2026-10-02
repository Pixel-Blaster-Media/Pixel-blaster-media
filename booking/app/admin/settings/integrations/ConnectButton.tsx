"use client";

import { useTransition } from "react";

import { startQuickBooksConnect } from "./actions";

export default function ConnectButton({ configurationError }: { configurationError?: string }) {
  const [pending, startPending] = useTransition();
  return (
    <div className="space-y-2">
      {configurationError ? (
        <p id="quickbooks-configuration-error" role="alert" className="text-sm text-amber-800">
          {configurationError}
        </p>
      ) : null}
      <button
      type="button"
      disabled={pending || Boolean(configurationError)}
      aria-describedby={configurationError ? "quickbooks-configuration-error" : undefined}
      onClick={() => startPending(() => startQuickBooksConnect())}
      className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white hover:bg-realtor-primary/90 disabled:opacity-60"
    >
      {pending ? "Redirecting…" : "Connect QuickBooks"}
      </button>
    </div>
  );
}
