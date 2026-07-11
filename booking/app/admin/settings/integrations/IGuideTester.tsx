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
    <div className="mt-4 border-t border-realtor-primary/10 pt-4">
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
              }. ${
                result.portalList === "available"
                  ? `Portal tour search is available (${result.portalTourCount ?? 0} returned).`
                  : result.portalList === "permission_needed"
                    ? "Add the iguide.list permission to enable portal tour search."
                    : "Linked-tour sync is ready; portal tour search could not be confirmed right now."
              }`,
            });
          });
        }}
        className="rounded-full border border-realtor-primary/20 bg-white px-4 py-1.5 text-xs font-semibold text-realtor-primary hover:border-realtor-primary/40 hover:bg-realtor-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Testing..." : "Test iGUIDE credentials"}
      </button>
      {disabled ? (
        <p className="mt-2 text-xs text-realtor-muted">
          Save both the App ID and App Token before testing.
        </p>
      ) : null}
      {message ? (
        <p
          className={
            "mt-2 text-xs " +
            (message.kind === "ok" ? "text-emerald-700" : "text-red-700")
          }
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
