"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  clearIntegrationCredentials,
  saveIntegrationCredentials,
} from "./actions";

export interface CredentialFieldDef {
  name: string;
  label: string;
  helper?: string;
  type?: "text" | "password";
}

export interface CredentialFieldStatus {
  source: "db" | "env" | "none";
  hint?: string;
}

export interface CredentialsFormProps {
  provider:
    | "autoenhance"
    | "fotello"
    | "google_maps"
    | "iguide"
    | "openai"
    | "resend";
  fields: CredentialFieldDef[];
  /** One status entry per field, keyed by field.name. */
  statuses: Record<string, CredentialFieldStatus>;
}

/**
 * Per-integration credential save form.
 *
 * Each field renders blank by default — even when a value is stored,
 * we never echo it back to the client (the status badge only shows
 * the last 4 chars). Submitting saves whichever fields the admin
 * filled in; empty fields are ignored, so partial updates are safe.
 *
 * "Clear" buttons next to each saved field remove that one field
 * from the DB row, falling back to the matching env var (if any).
 */
export default function CredentialsForm({
  provider,
  fields,
  statuses,
}: CredentialsFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);
  const [isPending, startTransition] = useTransition();

  function setField(name: string, v: string) {
    setValues((prev) => ({ ...prev, [name]: v }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const toSend: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v.trim()) toSend[k] = v.trim();
    }
    if (Object.keys(toSend).length === 0) {
      setMessage({ kind: "err", text: "Enter at least one value to save." });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const res = await saveIntegrationCredentials(provider, toSend);
      if (res.ok) {
        setMessage({ kind: "ok", text: "Saved. Takes effect immediately." });
        setValues({});
        router.refresh();
      } else {
        setMessage({
          kind: "err",
          text: res.error ?? "Could not save.",
        });
      }
    });
  }

  function clearField(field: string) {
    if (
      !confirm(
        `Clear the saved ${field}? It'll fall back to the environment variable if one's set.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await clearIntegrationCredentials(provider, [field]);
      if (res.ok) {
        setMessage({ kind: "ok", text: "Cleared." });
        router.refresh();
      } else {
        setMessage({
          kind: "err",
          text: res.error ?? "Could not clear.",
        });
      }
    });
  }

  function clearAllFields() {
    const savedFields = fields
      .filter((field) => statuses[field.name]?.source === "db")
      .map((field) => field.name);
    if (savedFields.length === 0) {
      setMessage({ kind: "err", text: "There are no saved values to clear." });
      return;
    }
    if (
      !confirm(
        `Clear all saved ${provider} values? Environment values, if any, will still be used.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await clearIntegrationCredentials(provider, savedFields);
      if (res.ok) {
        setMessage({ kind: "ok", text: "All saved values cleared." });
        router.refresh();
      } else {
        setMessage({
          kind: "err",
          text: res.error ?? "Could not clear.",
        });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4">
      {fields.map((f) => {
        const status = statuses[f.name];
        return (
          <div key={f.name}>
            <label className="block">
              <span className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-realtor-muted">
                <span>{f.label}</span>
                <StatusBadge status={status} onClear={() => clearField(f.name)} />
              </span>
              <input
                name={f.name}
                type={f.type ?? "password"}
                value={values[f.name] ?? ""}
                onChange={(e) => setField(f.name, e.currentTarget.value)}
                placeholder={
                  status?.source === "none"
                    ? "Paste value to save"
                    : "Paste new value to overwrite"
                }
                autoComplete="off"
                spellCheck={false}
                className="admin-input mt-1 font-mono text-xs"
              />
              {f.helper ? (
                <span className="mt-1 block text-[11px] text-realtor-muted">
                  {f.helper}
                </span>
              ) : null}
            </label>
          </div>
        );
      })}

      {message ? (
        <p
          className={
            "text-xs " +
            (message.kind === "ok" ? "text-emerald-700" : "text-red-700")
          }
        >
          {message.text}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full bg-realtor-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-realtor-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Save credentials"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={clearAllFields}
          className="rounded-full border border-red-200 bg-white px-4 py-1.5 text-xs font-semibold text-red-700 hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Clear all saved
        </button>
      </div>
    </form>
  );
}

function StatusBadge({
  status,
  onClear,
}: {
  status?: CredentialFieldStatus;
  onClear: () => void;
}) {
  if (!status || status.source === "none") {
    return (
      <span className="rounded-full border border-realtor-primary/15 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-realtor-muted">
        Not set
      </span>
    );
  }
  if (status.source === "env") {
    return (
      <span
        title={status.hint ? `Ends in ${status.hint}` : undefined}
        className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700"
      >
        From env {status.hint ? `· ${status.hint}` : ""}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span
        title={status.hint ? `Ends in ${status.hint}` : undefined}
        className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700"
      >
        Saved {status.hint ? `· ${status.hint}` : ""}
      </span>
      <button
        type="button"
        onClick={onClear}
        className="text-[10px] font-semibold uppercase tracking-wider text-red-700 hover:text-red-800"
      >
        Clear
      </button>
    </span>
  );
}
