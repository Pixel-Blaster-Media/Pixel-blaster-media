"use client";

import { useState } from "react";

export default function CopyAdminBookingLinkButton({
  value,
  compact = false,
}: {
  value: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }}
      className={
        compact
          ? "rounded-full bg-realtor-primary px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-realtor-primary/90"
          : "rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-realtor-primary/90"
      }
    >
      {copied ? "Copied" : compact ? "Copy" : "Copy booking link"}
    </button>
  );
}
