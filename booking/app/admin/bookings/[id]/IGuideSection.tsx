"use client";

import { useState, useTransition } from "react";

import { createIGuideForBooking, saveIGuideId, syncIGuide } from "./actions";

export default function IGuideSection({
  bookingId,
  initialIGuideId,
  initialPortalId,
  portalApiConfigured,
  job,
}: {
  bookingId: string;
  initialIGuideId: string | null;
  initialPortalId: string | null;
  portalApiConfigured: boolean;
  job: {
    status: string;
    work_order_id: string | null;
    default_view_id: string | null;
    match_source: string;
  } | null;
}) {
  // The input is a free-form paste field — admin can type an alias, a
  // youriguide.com URL, a portal id, or a manage.youriguide.com URL.
  // The server action detects which and stores on the right column.
  const [inputValue, setInputValue] = useState("");
  const [savedId, setSavedId] = useState(initialIGuideId);
  const [portalId, setPortalId] = useState(initialPortalId);
  const [saving, startSaving] = useTransition();
  const [syncing, startSyncing] = useTransition();
  const [creating, startCreating] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  function onSave() {
    setError(null);
    setOkMessage(null);
    startSaving(async () => {
      const res = await saveIGuideId(bookingId, inputValue);
      if (!res.ok) {
        setError(res.error ?? "Save failed.");
        return;
      }
      if (inputValue.trim() === "") {
        // Cleared both — reset state.
        setSavedId(null);
        setPortalId(null);
        setInputValue("");
        setOkMessage("Cleared.");
        return;
      }
      if (res.portalId !== undefined && res.portalId !== null) {
        setPortalId(res.portalId);
      }
      if (res.iguideId !== undefined && res.iguideId !== null) {
        setSavedId(res.iguideId);
      }
      setInputValue("");
      setOkMessage(res.portalId ? "Portal ID saved." : "Alias saved.");
    });
  }

  function onClear() {
    setError(null);
    setOkMessage(null);
    startSaving(async () => {
      const res = await saveIGuideId(bookingId, "");
      if (!res.ok) {
        setError(res.error ?? "Clear failed.");
        return;
      }
      setSavedId(null);
      setPortalId(null);
      setInputValue("");
      setOkMessage("Cleared.");
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

  function onCreate() {
    if (
      !confirm(
        "Create a new iGuide in the iGuide Portal for this booking? This will link the returned Portal ID to the booking automatically.",
      )
    ) {
      return;
    }
    setError(null);
    setOkMessage(null);
    startCreating(async () => {
      const res = await createIGuideForBooking(bookingId);
      if (!res.ok) {
        setError(res.error ?? "iGuide create failed.");
        return;
      }
      if (res.portalId) setPortalId(res.portalId);
      if (res.iguideId) setSavedId(res.iguideId);
      setOkMessage(
        `Created iGuide${res.workOrderId ? `, work order ${res.workOrderId}` : ""}.`,
      );
    });
  }

  const hasLink = Boolean(savedId || portalId);
  const canSave = inputValue.trim() !== "";
  const canCreate = portalApiConfigured && !portalId && !creating;

  return (
    <div
      id="iguide"
      className="space-y-4 rounded-2xl border border-brand/20 bg-brand/5 p-4"
    >
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
          iGuide
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          Create an iGuide from this booking for exact webhook matching, or
          paste any of: tour URL, alias, Portal ID (e.g. igYGFV5GG6V8DD1), or a
          manage.youriguide.com edit URL. Sync pulls the tour + floor plan into
          deliverables.{" "}
          {portalApiConfigured
            ? "Portal API is configured — sync uses the authenticated API when a portal ID is known."
            : "Portal API not configured — falls back to the public RESO autofill endpoint. Add IGUIDE_APP_ID / IGUIDE_APP_TOKEN in Vercel to enable."}{" "}
          The webhook populates the portal ID automatically when a tour
          goes live.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canCreate}
          onClick={onCreate}
          className="rounded-full bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create iGuide"}
        </button>
        {!portalApiConfigured ? (
          <p className="text-xs text-amber-300/80">
            Add iGuide API credentials before creating tours from here.
          </p>
        ) : portalId ? (
          <p className="text-xs text-ink-muted">
            This booking is already linked to an iGuide Portal record.
          </p>
        ) : null}
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Paste URL, alias, or Portal ID (igXXXXX)…"
          className="rounded-xl border border-white/10 bg-ink-soft px-3 py-2 text-sm text-white placeholder-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-brand-light/60"
        />
        <button
          type="button"
          disabled={saving || !canSave}
          onClick={onSave}
          className="rounded-full border border-white/15 px-3 py-2 text-sm text-white/90 hover:border-brand-light hover:bg-brand/10 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={syncing || !hasLink || canSave}
          onClick={onSync}
          className="rounded-full bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-50"
        >
          {syncing ? "Syncing…" : "Sync from iGuide"}
        </button>
      </div>
      <p className="text-xs text-ink-muted">
        Paste the iGUIDE link or Portal ID, click Save, then click Sync from
        iGuide. If sync complains about asset links, paste the public
        youriguide.com tour URL as well.
      </p>

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
              until the ready webhook fires. If that 401s, paste the
              Portal ID (igXXXXX) from manage.youriguide.com.
            </p>
          ) : null}
          {job ? (
            <p>
              Job:{" "}
              <span className="text-white/90">{job.status}</span>
              {job.work_order_id ? (
                <>
                  {" · "}Work order:{" "}
                  <code className="rounded bg-black/30 px-1 py-0.5 text-[11px] text-white/90">
                    {job.work_order_id}
                  </code>
                </>
              ) : null}
            </p>
          ) : null}
          <button
            type="button"
            onClick={onClear}
            disabled={saving}
            className="mt-1 text-[11px] text-ink-muted/80 underline hover:text-red-300 disabled:opacity-50"
          >
            Clear iGuide link
          </button>
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
