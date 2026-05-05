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
      className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:border-brand-light hover:bg-brand/10"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
