"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveIntegrationCredentials } from "./actions";

export default function ProviderEnablementToggle({
  provider,
  name,
  enabled,
  helper,
}: {
  provider: "autohdr" | "autoenhance";
  name: string;
  enabled: boolean;
  helper: string;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(enabled);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function change(next: boolean) {
    setChecked(next);
    setMessage(null);
    startTransition(async () => {
      const result = await saveIntegrationCredentials(provider, {
        enabled: next ? "true" : "false",
      });
      if (!result.ok) {
        setChecked(!next);
        setMessage(result.error ?? `Could not update ${name}.`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-4 flex items-start justify-between gap-4 rounded-xl border border-realtor-primary/12 bg-white/55 p-4">
      <div>
        <p className="text-sm font-semibold text-realtor-text">
          Use {name} in booking workflows
        </p>
        <p className="mt-1 text-xs leading-relaxed text-realtor-muted">{helper}</p>
        {message ? <p className="mt-2 text-xs text-red-700">{message}</p> : null}
      </div>
      <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-xs font-semibold text-realtor-text">
        <span>{checked ? "On" : "Off"}</span>
        <input
          type="checkbox"
          role="switch"
          aria-label={`Use ${name} in booking workflows`}
          aria-checked={checked}
          checked={checked}
          disabled={isPending}
          onChange={(event) => change(event.currentTarget.checked)}
          className="h-5 w-5 accent-realtor-primary"
        />
      </label>
    </div>
  );
}
