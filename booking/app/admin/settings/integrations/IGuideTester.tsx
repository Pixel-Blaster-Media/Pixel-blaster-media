"use client";

import { useState, useTransition } from "react";

import { testIGuideCredentials } from "./actions";

export default function IGuideTester({
  disabled,
}: {
  disabled: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);

  return (
    <div className="mt-4 border-t border-white/5 pt-4">
      <button
        type="button"
        disabled={disabled || isPending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await testIGuideCredentials();
            if (!result.ok) {
              setMessage({
                kind: "err",
                text: result.error ?? "iGUIDE credentials did not work.",
              });
              return;
            }
            setMessage({
              kind: "ok",
              text: `iGUIDE accepted the saved credentials${
                result.appIdLast4 ? ` ending in ${result.appIdLast4}` : ""
              }.`,
            });
          });
        }}
        className="rounded-md border border-white/15 px-4 py-1.5 text-xs font-semibold text-white hover:border-brand-light hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Testing..." : "Test iGUIDE credentials"}
      </button>
      {disabled ? (
        <p className="mt-2 text-xs text-ink-muted">
          Save both the App ID and App Token before testing.
        </p>
      ) : null}
      {message ? (
        <p
          className={
            "mt-2 text-xs " +
            (message.kind === "ok" ? "text-emerald-300" : "text-red-300")
          }
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
