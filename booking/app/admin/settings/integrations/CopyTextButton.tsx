"use client";

import { useState } from "react";

export default function CopyTextButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }}
      className="rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs font-semibold text-realtor-primary hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
