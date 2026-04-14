"use client";

import { useEffect, useState } from "react";

/**
 * Small client-only button that copies the given URL to the clipboard
 * and flashes a "Copied" state for a second. Falls back silently if the
 * Clipboard API isn't available (older browsers, insecure contexts) —
 * the user can still select/copy the URL text themselves.
 */
export default function CopyLinkButton({
  url,
  label = "Copy link",
}: {
  url: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(
      typeof navigator !== "undefined" &&
        typeof navigator.clipboard !== "undefined",
    );
  }, []);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setSupported(false);
    }
  }

  if (!supported) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener"
        className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:border-white/40"
      >
        Open link ↗
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/80 transition hover:border-brand-light hover:text-brand-light"
    >
      {copied ? "✓ Copied" : label}
    </button>
  );
}
