"use client";

import { useState, useTransition } from "react";

import { testGoogleCalendarConnection } from "./actions";

type TestResult = Awaited<ReturnType<typeof testGoogleCalendarConnection>>;

export default function GoogleCalendarTester() {
  const [pending, startPending] = useTransition();
  const [result, setResult] = useState<TestResult | null>(null);

  return (
    <div className="rounded-2xl border border-realtor-border bg-white/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-realtor-text">
            Test booking-to-calendar sync
          </p>
          <p className="mt-1 text-xs text-realtor-muted">
            Checks busy-time access, then creates a short test event so we know
            booking availability and calendar writes both work.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            startPending(() => {
              void (async () => {
                setResult(await testGoogleCalendarConnection());
              })();
            });
          }}
          className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white hover:bg-realtor-primary/90 disabled:opacity-60"
        >
          {pending ? "Testing..." : "Test calendar sync"}
        </button>
      </div>

      {result ? (
        <div
          role="status"
          aria-live="polite"
          className={`mt-3 rounded-xl border p-3 text-sm ${
            result.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {result.ok ? (
            <>
              <p className="font-semibold">
                Calendar availability and sync work.
              </p>
              <p className="mt-1">
                Calendar: <code>{result.calendarId}</code>
              </p>
              {result.eventUrl ? (
                <a
                  href={result.eventUrl}
                  target="_blank"
                  rel="noopener"
                  className="mt-2 inline-block underline"
                >
                  Open test event
                </a>
              ) : null}
            </>
          ) : (
            <>
              <p className="font-semibold">Calendar sync needs attention.</p>
              <p className="mt-1">{result.error}</p>
              <p className="mt-2 text-xs">
                Client ID: {result.config.clientIdPresent ? "present" : "missing"}
                {" · "}Client secret:{" "}
                {result.config.clientSecretPresent ? "present" : "missing"}
                {" · "}Connection:{" "}
                {result.config.connectionPresent ? "present" : "missing"}
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
