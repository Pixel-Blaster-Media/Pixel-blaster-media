"use client";

import { useEffect } from "react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin error boundary]", error);
  }, [error]);

  return (
    <main className="rounded-3xl border border-realtor-primary/15 bg-realtor-surface/85 p-6 text-center shadow-lg shadow-realtor-text/10 md:p-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-realtor-primary/80">
        Something went wrong
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-realtor-text">
        This admin page hit an error.
      </h1>
      <p className="mt-3 text-sm leading-6 text-realtor-muted">
        Your data is fine — this is a display error. Try again, or head back
        to Today.
        {error.digest ? (
          <span className="mt-2 block text-xs text-realtor-muted/70">
            Error reference: {error.digest}
          </span>
        ) : null}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="tap-target rounded-full bg-realtor-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-realtor-primary-light"
        >
          Try again
        </button>
        <a
          href="/admin/today"
          className="tap-target rounded-full border border-realtor-primary/20 px-5 py-2.5 text-sm text-realtor-muted transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
        >
          Back to Today
        </a>
      </div>
    </main>
  );
}
