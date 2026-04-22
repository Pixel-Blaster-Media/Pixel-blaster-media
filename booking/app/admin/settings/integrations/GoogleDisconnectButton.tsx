"use client";

import { useTransition } from "react";

import { disconnectGoogleCalendar } from "./actions";

export default function GoogleDisconnectButton() {
  const [pending, startPending] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (
          !confirm(
            "Disconnect Google Calendar? Realtors' booking slots will stop checking your personal calendar until you reconnect.",
          )
        )
          return;
        startPending(() => disconnectGoogleCalendar());
      }}
      className="rounded-md border border-red-400/30 px-3 py-1.5 text-xs text-red-200 hover:border-red-400/60 disabled:opacity-60"
    >
      {pending ? "Disconnecting…" : "Disconnect"}
    </button>
  );
}
