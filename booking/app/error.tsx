"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app error boundary]", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-ink-soft/60 p-8 text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-light">
        Something went wrong
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-white">
        Sorry — that did not work.
      </h1>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        Nothing was lost. Try again, and if it keeps happening, email{" "}
        <a className="text-brand-light" href="mailto:info@pixelblastermedia.com">
          info@pixelblastermedia.com
        </a>{" "}
        and we will sort it out.
      </p>
      <div className="mt-6 flex justify-center">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-light"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
