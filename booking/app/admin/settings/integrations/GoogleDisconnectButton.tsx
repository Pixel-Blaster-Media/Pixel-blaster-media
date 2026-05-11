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
      className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:border-red-300 hover:bg-red-50 disabled:opacity-60"
    >
      {pending ? "Disconnecting…" : "Disconnect"}
    </button>
  );
}
