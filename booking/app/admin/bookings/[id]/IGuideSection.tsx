"use client";

import { useState, useTransition } from "react";

import { saveIGuideId, syncIGuide } from "./actions";

export default function IGuideSection({
  bookingId,
  initialIGuideId,
  initialPortalId,
  portalApiConfigured,
}: {
  bookingId: string;
  initialIGuideId: string | null;
  initialPortalId: string | null;
  portalApiConfigured: boolean;
}) {
  const [iguideId, setIGuideId] = useState(initialIGuideId ?? "");
  const [savedId, setSavedId] = useState(initialIGuideId);
  const [portalId, setPortalId] = useState(initialPortalId);
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
      if (res.iguideId === null) setPortalId(null);
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
      if (res.portalId) setPortalId(res.portalId);
      setOkMessage(
        `Synced ${res.upserts ?? 0} deliverable(s)${
          res.address ? ` from ${res.address}` : ""
        }.`,
      );
    });
  }

  const isDirty = (iguideId.trim() || null) !== savedId;
  const hasLink = Boolean(savedId || portalId);

  return (
    <div className="space-y-4 rounded-lg border border-brand/20 bg-brand/5 p-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
          iGuide
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          Paste the iGuide URL or alias after you publish the tour. Sync
          pulls the tour + floor plan into deliverables.{" "}
          {portalApiConfigured
            ? "Portal API is configured — sync uses the authenticated API when a portal ID is known."
            : "Portal API not configured — falls back to the public RESO autofill endpoint. Add IGUIDE_APP_ID / IGUIDE_APP_TOKEN in Vercel to enable."}{" "}
          The webhook populates the portal ID automatically when a tour
          goes live.
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
          disabled={syncing || !hasLink || isDirty}
          onClick={onSync}
          className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-50"
        >
          {syncing ? "Syncing…" : "Sync from iGuide"}
        </button>
      </div>

      {savedId || portalId ? (
        <div className="space-y-1 text-xs text-ink-muted">
          {savedId ? (
            <p>
              Alias:{" "}
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
          {portalId ? (
            <p>
              Portal ID:{" "}
              <code className="rounded bg-black/30 px-1 py-0.5 text-[11px] text-white/90">
                {portalId}
              </code>
              <span className="ml-2 text-emerald-300">
                · Portal API ready
              </span>
            </p>
          ) : savedId ? (
            <p className="text-amber-300/80">
              No portal ID yet — sync will use the public RESO endpoint
              until the ready webhook fires.
            </p>
          ) : null}
        </div>
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
