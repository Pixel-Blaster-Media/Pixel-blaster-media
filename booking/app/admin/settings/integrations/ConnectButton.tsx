"use client";

import { useTransition } from "react";

import { startQuickBooksConnect } from "./actions";

export default function ConnectButton() {
  const [pending, startPending] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startPending(() => startQuickBooksConnect())}
      className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white hover:bg-realtor-primary/90 disabled:opacity-60"
    >
      {pending ? "Redirecting…" : "Connect QuickBooks"}
    </button>
  );
}
