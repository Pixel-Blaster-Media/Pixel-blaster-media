"use client";

import { useTransition } from "react";

import { disconnectQuickBooks } from "./actions";

export default function DisconnectButton() {
  const [pending, startPending] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm("Disconnect QuickBooks? You'll need to reconnect to invoice.")) return;
        startPending(() => disconnectQuickBooks());
      }}
      className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:border-red-300 hover:bg-red-50 disabled:opacity-60"
    >
      {pending ? "Disconnecting…" : "Disconnect"}
    </button>
  );
}
