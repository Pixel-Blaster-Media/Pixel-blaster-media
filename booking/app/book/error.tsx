"use client";

import { useEffect } from "react";

/**
 * Booking-flow error boundary — realtor-facing, so it uses the light
 * realtor theme (the segment layout still wraps this) and keeps the
 * realtor's wizard state: "Try again" re-renders the service selections
 * and reloads property details from the unexpired private browser draft.
 */
export default function BookError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[book error boundary]", error);
  }, [error]);

  return (
    <main className="realtor-elevated-panel rounded-3xl p-6 text-center md:p-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-realtor-primary">
        Something went wrong
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-realtor-text">
        Sorry — that did not work.
      </h1>
      <p className="mt-3 text-sm leading-6 text-realtor-muted">
        Try again to reload your saved selections. If this keeps happening, email{" "}
        <a
          className="font-semibold text-realtor-primary"
          href="mailto:info@pixelblastermedia.com"
        >
          info@pixelblastermedia.com
        </a>{" "}
        and we will book you in directly.
      </p>
      <div className="mt-6 flex justify-center">
        <button
          type="button"
          onClick={reset}
          className="tap-target rounded-full bg-realtor-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-realtor-primary-light"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
