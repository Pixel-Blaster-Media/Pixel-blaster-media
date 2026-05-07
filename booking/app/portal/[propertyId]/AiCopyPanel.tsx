"use client";

import { useState, useTransition } from "react";

import { generateListingCopy, type CopyKind } from "./ai-actions";

const OPTIONS: Array<{ kind: CopyKind; label: string; description: string }> = [
  {
    kind: "mls_description",
    label: "MLS description",
    description: "A polished listing paragraph.",
  },
  {
    kind: "instagram_caption",
    label: "Instagram caption",
    description: "Caption, hooks, and hashtags.",
  },
  {
    kind: "seller_email",
    label: "Seller email",
    description: "A friendly update for the homeowner.",
  },
  {
    kind: "listing_highlights",
    label: "Listing highlights",
    description: "Bullets and quick social hooks.",
  },
];

export default function AiCopyPanel({
  propertyId,
  compact = false,
}: {
  propertyId: string;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState<CopyKind>("mls_description");
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function generate(kind: CopyKind) {
    setActive(kind);
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await generateListingCopy(propertyId, kind);
      if (!res.ok || !res.text) {
        setError(res.error ?? "Could not generate copy.");
        return;
      }
      setDraft(res.text);
      setMessage("Draft generated. Review and edit before posting.");
    });
  }

  async function copyDraft() {
    if (!draft) return;
    await navigator.clipboard.writeText(draft);
    setMessage("Copied.");
  }

  return (
    <section className="realtor-green-panel rounded-2xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-realtor-primary">
            AI copy assistant
          </p>
          <h2 className="mt-1 text-lg font-semibold text-realtor-text">
            Draft listing copy from this media
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-realtor-muted">
            Generates editable drafts from this listing. Always review before
            posting to MLS or social.
          </p>
        </div>
        <button
          type="button"
          disabled={!draft}
          onClick={copyDraft}
          className="rounded-md border border-realtor-primary/20 px-3 py-1.5 text-xs font-semibold text-realtor-text hover:border-realtor-primary hover:text-realtor-primary disabled:opacity-40"
        >
          Copy draft
        </button>
      </div>

      <div className={`mt-4 grid gap-2 ${compact ? "" : "md:grid-cols-4"}`}>
        {OPTIONS.map((option) => (
          <button
            key={option.kind}
            type="button"
            disabled={pending}
            onClick={() => generate(option.kind)}
            className={
              "rounded-lg border p-3 text-left transition disabled:opacity-60 " +
              (active === option.kind
                ? "border-realtor-primary bg-realtor-primary/15"
                : "border-realtor-primary/15 bg-realtor-surface/85 hover:border-realtor-primary/40")
            }
          >
            <span className="block text-sm font-semibold text-realtor-text">
              {option.label}
            </span>
            <span className="mt-1 block text-[11px] text-realtor-muted">
              {option.description}
            </span>
          </button>
        ))}
      </div>

      <textarea
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        rows={compact ? 8 : 12}
        placeholder={
          pending
            ? "Writing..."
            : "Choose a draft type above. Your generated copy will appear here."
        }
        className="realtor-field mt-4 w-full rounded-lg px-3 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-realtor-primary/60"
      />
      {message ? (
        <p className="mt-2 text-xs text-emerald-700">{message}</p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
