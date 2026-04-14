import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Request received",
};

// Intentionally minimal — we don't echo the submitted details back to the
// page (no per-request URL token, so anyone with the link could otherwise
// see them). The full summary lives in the confirmation email instead.
export default function BookingSuccess() {
  return (
    <div className="max-w-xl space-y-6">
      <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
        ✓ Request received
      </p>
      <h1 className="text-3xl font-bold text-white md:text-4xl">
        Thanks — we'll be in touch within 24 hours.
      </h1>
      <p className="text-ink-muted">
        We've emailed you a copy of your request. We'll reply to confirm the
        date and any details. If you don't see the email in a few minutes,
        check your spam folder, or just email{" "}
        <a
          href="mailto:Info@PixelBlasterMedia.com"
          className="text-brand-light underline"
        >
          Info@PixelBlasterMedia.com
        </a>
        .
      </p>
      <div className="flex flex-wrap gap-3 pt-2">
        <Link
          href="/"
          className="rounded-md border border-brand/40 px-4 py-2 text-sm font-semibold text-brand-light hover:border-brand-light hover:bg-brand/10"
        >
          Back to start
        </Link>
        <a
          href="https://www.pixelblastermedia.com"
          className="rounded-md border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 hover:border-white/40"
        >
          Pixel Blaster Media ↗
        </a>
      </div>
    </div>
  );
}
