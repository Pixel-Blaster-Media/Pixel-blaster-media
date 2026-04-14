"use client";

import { useState, useTransition } from "react";

import { saveIGuideId, syncIGuide } from "./actions";

export default function IGuideSection({
  bookingId,
  initialIGuideId,
}: {
  bookingId: string;
  initialIGuideId: string | null;
}) {
  const [iguideId, setIGuideId] = useState(initialIGuideId ?? "");
  const [savedId, setSavedId] = useState(initialIGuideId);
  const [saving, startSaving] = useTransition();
  const [syncing, startSyncing] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  function onSave() {
    setError(null);
    setOkMessage(null);
    startSaving(async () => {
      const res = await saveIGuideId(bookingId, iguideId);
      if (!res.ok) {
        setError(res.error ?? "Save failed.");
        return;
      }
      setSavedId(res.iguideId ?? null);
      setIGuideId(res.iguideId ?? "");
      setOkMessage(res.iguideId ? "Saved." : "Cleared.");
    });
  }

  function onSync() {
    setError(null);
    setOkMessage(null);
    startSyncing(async () => {
      const res = await syncIGuide(bookingId);
      if (!res.ok) {
        setError(res.error ?? "Sync failed.");
        return;
      }
      setOkMessage(
        `Synced ${res.upserts ?? 0} deliverable(s)${
          res.address ? ` from ${res.address}` : ""
        }.`,
      );
    });
  }

  const isDirty = (iguideId.trim() || null) !== savedId;

  return (
    <div className="space-y-4 rounded-lg border border-brand/20 bg-brand/5 p-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
          iGuide
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          Paste the iGuide URL or ID after you publish the tour. Sync pulls
          the tour viewer + floor plan PDF into deliverables. The webhook
          (if configured) does this automatically when the tour goes live.
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
        <input
          type="text"
          value={iguideId}
          onChange={(e) => setIGuideId(e.target.value)}
          placeholder="1044_rest_acres_rd_brant_on  or  https://youriguide.com/..."
          className="rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-sm text-white placeholder-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-brand-light/60"
        />
        <button
          type="button"
          disabled={saving || !isDirty}
          onClick={onSave}
          className="rounded-md border border-white/15 px-3 py-2 text-sm text-white/90 hover:border-brand-light hover:bg-brand/10 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={syncing || !savedId || isDirty}
          onClick={onSync}
          className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-50"
        >
          {syncing ? "Syncing…" : "Sync from iGuide"}
        </button>
      </div>

      {savedId ? (
        <p className="text-xs text-ink-muted">
          Linked to{" "}
          <a
            href={`https://youriguide.com/${savedId}/`}
            target="_blank"
            rel="noopener"
            className="text-brand-light underline"
          >
            youriguide.com/{savedId}
          </a>
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {okMessage ? (
        <p className="text-xs text-emerald-300">{okMessage}</p>
      ) : null}
    </div>
  );
}
