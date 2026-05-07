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
      className="rounded-full border border-red-400/30 px-3 py-1.5 text-xs text-red-200 hover:border-red-400/60 disabled:opacity-60"
    >
      {pending ? "Disconnecting…" : "Disconnect"}
    </button>
  );
}
