"use client";

import { useState, useTransition } from "react";

import {
  saveFotelloListingId,
  trackFotelloEnhance,
  untrackFotelloEnhance,
} from "./actions";

interface FotelloDeliverable {
  id: string;
  external_id: string | null;
  status: string | null;
  shotType: string | null;
  syncedAt: string | null;
}

export default function FotelloSection({
  bookingId,
  initialListingId,
  deliverables,
}: {
  bookingId: string;
  initialListingId: string | null;
  deliverables: FotelloDeliverable[];
}) {
  const [listingId, setListingId] = useState(initialListingId ?? "");
  const [savedListingId, setSavedListingId] = useState(initialListingId);
  const [savingListing, startSavingListing] = useTransition();
  const [listingError, setListingError] = useState<string | null>(null);

  const [enhanceInput, setEnhanceInput] = useState("");
  const [shotType, setShotType] = useState<"interior" | "exterior">("interior");
  const [trackingPending, startTracking] = useTransition();
  const [trackError, setTrackError] = useState<string | null>(null);
  const [trackOk, setTrackOk] = useState<string | null>(null);

  const listingDirty = (listingId.trim() || null) !== savedListingId;

  function onSaveListing() {
    setListingError(null);
    startSavingListing(async () => {
      const res = await saveFotelloListingId(bookingId, listingId);
      if (!res.ok) {
        setListingError(res.error ?? "Save failed.");
        return;
      }
      setSavedListingId(res.listingId ?? null);
      setListingId(res.listingId ?? "");
    });
  }

  function onTrack() {
    setTrackError(null);
    setTrackOk(null);
    startTracking(async () => {
      const res = await trackFotelloEnhance(bookingId, enhanceInput, shotType);
      if (!res.ok) {
        setTrackError(res.error ?? "Track failed.");
        return;
      }
      setTrackOk(
        res.status === "completed"
          ? "Gallery ready — added to realtor portal."
          : `Tracking · status: ${res.status ?? "unknown"}. Click Refresh later.`,
      );
      setEnhanceInput("");
    });
  }

  return (
    <div className="space-y-5 rounded-lg border border-brand/20 bg-brand/5 p-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
          Fotello
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          Track the Fotello listing + each enhance you kicked off. We poll
          Fotello for status; when an enhance completes its gallery shows up
          on the realtor's portal page automatically.
        </p>
      </div>

      {/* Listing ID */}
      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-ink-muted">
          Fotello listing ID
        </label>
        <div className="mt-1 flex flex-wrap gap-2">
          <input
            type="text"
            value={listingId}
            onChange={(e) => setListingId(e.target.value)}
            placeholder="Paste the listing id from Fotello"
            className="flex-1 min-w-[260px] rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-sm text-white placeholder-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-brand-light/60"
          />
          <button
            type="button"
            disabled={savingListing || !listingDirty}
            onClick={onSaveListing}
            className="rounded-md border border-white/15 px-3 py-2 text-sm text-white/90 hover:border-brand-light hover:bg-brand/10 disabled:opacity-50"
          >
            {savingListing ? "Saving…" : "Save"}
          </button>
        </div>
        {listingError ? (
          <p className="mt-1 text-xs text-red-300" role="alert">
            {listingError}
          </p>
        ) : null}
      </div>

      {/* Track a new enhance */}
      <div className="rounded-md border border-white/10 bg-ink-soft/50 p-3">
        <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">
          Track an enhance
        </p>
        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_140px_auto]">
          <input
            type="text"
            value={enhanceInput}
            onChange={(e) => setEnhanceInput(e.target.value)}
            placeholder="Enhance ID from Fotello"
            className="rounded-md border border-white/10 bg-ink px-3 py-2 text-sm text-white placeholder-ink-muted/60"
          />
          <select
            value={shotType}
            onChange={(e) =>
              setShotType(e.target.value as "interior" | "exterior")
            }
            className="rounded-md border border-white/10 bg-ink px-3 py-2 text-sm text-white"
          >
            <option value="interior">Interior</option>
            <option value="exterior">Exterior</option>
          </select>
          <button
            type="button"
            disabled={trackingPending || !enhanceInput.trim()}
            onClick={onTrack}
            className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-50"
          >
            {trackingPending ? "Checking…" : "Track"}
          </button>
        </div>
        {trackError ? (
          <p className="mt-2 text-xs text-red-300" role="alert">
            {trackError}
          </p>
        ) : null}
        {trackOk ? (
          <p className="mt-2 text-xs text-emerald-300">{trackOk}</p>
        ) : null}
      </div>

      {/* Tracked enhances */}
      {deliverables.length > 0 ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">
            Tracked enhances ({deliverables.length})
          </p>
          <ul className="mt-2 space-y-2">
            {deliverables.map((d) => (
              <TrackedEnhanceRow
                key={d.id}
                bookingId={bookingId}
                deliverable={d}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function TrackedEnhanceRow({
  bookingId,
  deliverable,
}: {
  bookingId: string;
  deliverable: FotelloDeliverable;
}) {
  const [refreshing, startRefresh] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState(deliverable.status);

  async function onRefresh() {
    setError(null);
    startRefresh(async () => {
      const res = await trackFotelloEnhance(
        bookingId,
        deliverable.external_id ?? "",
        (deliverable.shotType as "interior" | "exterior") ?? "interior",
      );
      if (!res.ok) setError(res.error ?? "Refresh failed.");
      else setLocalStatus(res.status ?? localStatus);
    });
  }

  async function onDelete() {
    if (!confirm("Stop tracking this enhance? (It stays in Fotello — this only removes it from the booking.)"))
      return;
    setError(null);
    startDelete(async () => {
      await untrackFotelloEnhance(bookingId, deliverable.id);
    });
  }

  const statusChip = statusChipFor(localStatus);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 bg-ink-soft/40 p-3 text-sm">
      <div className="min-w-0">
        <p className="truncate font-mono text-xs text-white">
          {deliverable.external_id ?? "—"}
        </p>
        <p className="mt-0.5 text-[11px] text-ink-muted">
          {deliverable.shotType ?? "?"} ·{" "}
          {deliverable.syncedAt
            ? `synced ${new Date(deliverable.syncedAt).toLocaleTimeString()}`
            : "never synced"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${statusChip.className}`}
        >
          {statusChip.label}
        </span>
        <button
          type="button"
          disabled={refreshing}
          onClick={onRefresh}
          className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-white hover:border-brand-light hover:text-brand-light disabled:opacity-50"
        >
          {refreshing ? "…" : "Refresh"}
        </button>
        <button
          type="button"
          disabled={deleting}
          onClick={onDelete}
          className="text-xs text-red-300 hover:text-red-200 disabled:opacity-50"
        >
          {deleting ? "…" : "Remove"}
        </button>
      </div>
      {error ? (
        <p className="w-full text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function statusChipFor(status: string | null): {
  label: string;
  className: string;
} {
  switch ((status ?? "").toLowerCase()) {
    case "completed":
      return {
        label: "Ready",
        className:
          "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
      };
    case "failed":
      return {
        label: "Failed",
        className: "border-red-400/40 bg-red-400/10 text-red-200",
      };
    case "in_progress":
    case "pending":
      return {
        label: "In progress",
        className: "border-amber-400/40 bg-amber-400/10 text-amber-200",
      };
    default:
      return {
        label: status ?? "Unknown",
        className: "border-white/15 text-ink-muted",
      };
  }
}
