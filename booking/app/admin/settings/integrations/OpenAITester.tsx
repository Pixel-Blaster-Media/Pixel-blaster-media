"use client";

import { useState, useTransition } from "react";

import { testOpenAICredentials } from "./actions";

type TestResult = Awaited<ReturnType<typeof testOpenAICredentials>>;

export default function OpenAITester() {
  const [pending, startPending] = useTransition();
  const [result, setResult] = useState<TestResult | null>(null);

  return (
    <div className="mt-4 rounded-2xl border border-realtor-border bg-white/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-realtor-text">
            Test AI assistant
          </p>
          <p className="mt-1 text-xs text-realtor-muted">
            Sends a tiny request so you know the saved key and model work before
            relying on the assistant.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            startPending(() => {
              void (async () => setResult(await testOpenAICredentials()))();
            });
          }}
          className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white hover:bg-realtor-primary/90 disabled:opacity-60"
        >
          {pending ? "Testing..." : "Test AI"}
        </button>
      </div>

      {result ? (
        <div
          className={`mt-3 rounded-xl border p-3 text-sm ${
            result.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {result.ok ? (
            <>
              <p className="font-semibold">AI connection works.</p>
              <p className="mt-1 text-xs">
                Source: {result.source === "company" ? "company key" : "platform fallback"}
                {result.model ? ` · Model: ${result.model}` : ""}
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">AI connection needs attention.</p>
              <p className="mt-1">{result.error}</p>
              {result.model || result.source !== "none" ? (
                <p className="mt-2 text-xs">
                  Source: {result.source}
                  {result.model ? ` · Model: ${result.model}` : ""}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
