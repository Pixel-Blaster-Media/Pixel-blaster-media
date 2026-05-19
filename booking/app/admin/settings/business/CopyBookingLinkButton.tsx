"use client";

import { useState } from "react";

export default function CopyBookingLinkButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }}
      className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-realtor-primary/20 transition hover:bg-realtor-primary/90"
    >
      {copied ? "Copied" : "Copy booking link"}
    </button>
  );
}
