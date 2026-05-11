"use client";

import { useState, useTransition } from "react";

import { sendTestEmail } from "./actions";

interface TestResult {
  ok: boolean;
  skipped?: boolean;
  id?: string;
  error?: string;
  config: {
    resendApiKeyPresent: boolean;
    emailFrom: string | null;
  };
}

export default function EmailTester({ defaultTo }: { defaultTo: string }) {
  const [to, setTo] = useState(defaultTo);
  const [sending, startSending] = useTransition();
  const [result, setResult] = useState<TestResult | null>(null);

  function onSend() {
    setResult(null);
    startSending(async () => {
      const res = await sendTestEmail(to);
      setResult(res);
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="you@example.com"
          className="admin-input"
        />
        <button
          type="button"
          disabled={sending || !to.trim()}
          onClick={onSend}
          className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white hover:bg-realtor-primary/90 disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send test email"}
        </button>
      </div>

      {result ? (
        <div
          className={`rounded-2xl border p-3 text-xs ${
            result.ok && !result.skipped
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : result.skipped
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <p className="font-semibold">
            {result.ok && !result.skipped
              ? "Sent."
              : result.skipped
                ? "Skipped (not configured)."
                : "Failed."}
          </p>
          <dl className="mt-2 grid gap-y-0.5 text-[11px] md:grid-cols-[160px_1fr]">
            {result.id ? (
              <>
                <dt className="text-realtor-muted">Resend message id</dt>
                <dd>
                  <code>{result.id}</code>
                </dd>
              </>
            ) : null}
            {result.error ? (
              <>
                <dt className="text-realtor-muted">Error</dt>
                <dd>{result.error}</dd>
              </>
            ) : null}
            <dt className="text-realtor-muted">RESEND_API_KEY</dt>
            <dd>
              {result.config.resendApiKeyPresent
                ? "set"
                : "NOT set in Vercel env"}
            </dd>
            <dt className="text-realtor-muted">EMAIL_FROM</dt>
            <dd>
              {result.config.emailFrom ? (
                <code>{result.config.emailFrom}</code>
              ) : (
                "NOT set in Vercel env"
              )}
            </dd>
          </dl>
          {result.ok && !result.skipped ? (
            <p className="mt-2 text-emerald-700">
              Check {to} — the email should land within a few seconds. If
              it doesn&apos;t, check Resend&apos;s dashboard → Logs.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
