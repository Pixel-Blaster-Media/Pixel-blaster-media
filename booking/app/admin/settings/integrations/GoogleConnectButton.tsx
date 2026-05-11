"use client";

import { useTransition } from "react";

import { startGoogleCalendarConnect } from "./actions";

export default function GoogleConnectButton() {
  const [pending, startPending] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startPending(() => startGoogleCalendarConnect())}
      className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white hover:bg-realtor-primary/90 disabled:opacity-60"
    >
      {pending ? "Redirecting…" : "Connect Google Calendar"}
    </button>
  );
}
