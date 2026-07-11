"use client";

import { useMemo, useState, useTransition } from "react";

import {
  createIGuideForBooking,
  listExistingIGuides,
  saveIGuideId,
  saveIGuidePhotoDownloads,
  syncIGuide,
  type ExistingIGuideOption,
} from "./actions";

export default function IGuideSection({
  bookingId,
  initialIGuideId,
  initialPortalId,
  portalApiConfigured,
  job,
  initialPhotoDownloads,
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
  initialPhotoDownloads: {
    mls: string | null;
    highRes: string | null;
  };
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
  const [photoSaving, startPhotoSaving] = useTransition();
  const [tourLoading, startTourLoading] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [tourPickerOpen, setTourPickerOpen] = useState(false);
  const [tourSearch, setTourSearch] = useState("");
  const [portalTours, setPortalTours] = useState<
    ExistingIGuideOption[] | null
  >(null);

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

  function openTourPicker() {
    setTourPickerOpen((open) => !open);
    if (portalTours || tourLoading) return;
    setError(null);
    startTourLoading(async () => {
      const result = await listExistingIGuides(bookingId);
      if (!result.ok) {
        setError(result.error);
        setTourPickerOpen(false);
        return;
      }
      setPortalTours(result.tours);
    });
  }

  function selectPortalTour(tour: ExistingIGuideOption) {
    setError(null);
    setOkMessage(null);
    startSaving(async () => {
      const saved = await saveIGuideId(bookingId, tour.id);
      if (!saved.ok) {
        setError(saved.error ?? "Could not link that iGUIDE.");
        return;
      }

      setPortalId(saved.portalId ?? tour.id);
      if (tour.alias) {
        const aliasSaved = await saveIGuideId(bookingId, tour.alias);
        if (!aliasSaved.ok) {
          setError(
            `The Portal ID was linked, but its public alias could not be saved: ${
              aliasSaved.error ?? "save failed"
            }`,
          );
          return;
        }
        if (aliasSaved.iguideId) setSavedId(aliasSaved.iguideId);
      }
      setTourPickerOpen(false);
      setTourSearch("");

      const synced = await syncIGuide(bookingId);
      if (!synced.ok) {
        setError(
          `iGUIDE linked, but its media did not sync yet: ${
            synced.error ?? "sync failed"
          }`,
        );
        return;
      }
      if (synced.portalId) setPortalId(synced.portalId);
      setOkMessage(
        `Linked${tour.address ? ` ${tour.address}` : " the selected iGUIDE"} and synced ${
          synced.upserts ?? 0
        } deliverable(s).`,
      );
    });
  }

  const hasLink = Boolean(savedId || portalId);
  const canSave = inputValue.trim() !== "";
  const canCreate = portalApiConfigured && !portalId && !creating;
  const filteredPortalTours = useMemo(() => {
    const query = tourSearch.trim().toLowerCase();
    if (!query) return portalTours ?? [];
    return (portalTours ?? []).filter((tour) =>
      [tour.address, tour.alias, tour.id, tour.status]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [portalTours, tourSearch]);

  return (
    <div
      id="iguide"
      className="space-y-4 rounded-2xl border border-realtor-primary/20 bg-realtor-primary/5 p-4"
    >
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-realtor-primary">
          iGuide
        </h2>
        <p className="mt-1 text-xs text-realtor-muted">
          Create an iGUIDE from this booking, choose an existing tour from your
          portal, or paste a tour URL as a fallback. Sync refreshes the tour,
          floor plans, previews, and available photo downloads.{" "}
          {portalApiConfigured
            ? "Portal API is configured — sync uses the authenticated API when a portal ID is known."
            : "Portal API not configured — sync can only use the limited public fallback. Connect iGUIDE in Settings → Integrations to enable the full workflow."}{" "}
          The webhook populates the portal ID automatically when a tour
          goes live.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canCreate}
          onClick={onCreate}
          className="rounded-full bg-realtor-primary px-3 py-2 text-sm font-semibold text-white hover:bg-realtor-primary/90 disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create iGUIDE"}
        </button>
        <button
          type="button"
          disabled={!portalApiConfigured || tourLoading || saving}
          onClick={openTourPicker}
          className="rounded-full border border-realtor-primary/25 bg-white px-3 py-2 text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/45 hover:bg-realtor-primary/5 disabled:opacity-50"
        >
          {tourLoading
            ? "Loading iGUIDEs..."
            : tourPickerOpen
              ? "Close iGUIDE list"
              : "Choose existing iGUIDE"}
        </button>
        {!portalApiConfigured ? (
          <p className="text-xs text-amber-700">
            Add iGuide API credentials before creating tours from here.
          </p>
        ) : portalId ? (
          <p className="text-xs text-realtor-muted">
            This booking is already linked to an iGuide Portal record.
          </p>
        ) : null}
      </div>

      {tourPickerOpen ? (
        <div className="rounded-2xl border border-realtor-primary/15 bg-white/80 p-3 shadow-sm">
          <label className="block">
            <span className="text-xs font-semibold text-realtor-muted">
              Search your iGUIDEs
            </span>
            <input
              type="search"
              value={tourSearch}
              onChange={(event) => setTourSearch(event.target.value)}
              placeholder="Search by address, alias, or Portal ID"
              className="mt-1 w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2.5 text-sm text-realtor-text placeholder-realtor-muted/60 outline-none focus:border-realtor-primary/45"
            />
          </label>
          <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
            {filteredPortalTours.length ? (
              filteredPortalTours.map((tour) => {
                const isLinked = portalId === tour.id;
                return (
                  <button
                    key={tour.id}
                    type="button"
                    disabled={saving || isLinked}
                    onClick={() => selectPortalTour(tour)}
                    className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-realtor-primary/10 bg-realtor-surface px-3 py-2 text-left transition hover:border-realtor-primary/30 hover:bg-realtor-primary/5 disabled:opacity-60"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-realtor-text">
                        {tour.address || tour.alias || tour.id}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-realtor-muted">
                        {[tour.alias, tour.status, tour.id]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full border border-realtor-primary/15 px-2.5 py-1 text-[10px] font-semibold text-realtor-primary">
                      {isLinked ? "Linked" : "Choose"}
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="rounded-xl border border-dashed border-realtor-primary/15 px-3 py-4 text-center text-xs text-realtor-muted">
                {portalTours?.length === 0
                  ? "No iGUIDEs were returned by this portal account."
                  : "No iGUIDEs match that search."}
              </p>
            )}
          </div>
        </div>
      ) : null}

      <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Paste URL, alias, or Portal ID (igXXXXX)…"
          className="rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text placeholder-realtor-muted/60 focus:outline-none focus:ring-2 focus:ring-realtor-primary/60"
        />
        <button
          type="button"
          disabled={saving || !canSave}
          onClick={onSave}
          className="rounded-full border border-realtor-primary/20 px-3 py-2 text-sm text-realtor-text/90 hover:border-realtor-primary/40 hover:bg-realtor-primary/10 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={syncing || !hasLink || canSave}
          onClick={onSync}
          className="rounded-full bg-realtor-primary px-3 py-2 text-sm font-semibold text-white hover:bg-realtor-primary/90 disabled:opacity-50"
        >
          {syncing ? "Syncing…" : "Sync from iGUIDE"}
        </button>
      </div>
      <p className="text-xs text-realtor-muted">
        Choose from your portal above, or paste a link/Portal ID as a fallback.
        Pasted references still need Save, then Sync from iGUIDE.
      </p>

      {savedId || portalId ? (
        <div className="space-y-1 text-xs text-realtor-muted">
          {savedId ? (
            <p>
              Alias:{" "}
              <a
                href={`https://youriguide.com/${savedId}/`}
                target="_blank"
                rel="noopener"
                className="text-realtor-primary underline"
              >
                youriguide.com/{savedId}
              </a>
            </p>
          ) : null}
          {portalId ? (
            <p>
              Portal ID:{" "}
              <code className="rounded bg-white/65 px-1 py-0.5 text-[11px] text-realtor-text/90">
                {portalId}
              </code>
              <span className="ml-2 text-emerald-700">
                · Portal API ready
              </span>
            </p>
          ) : savedId ? (
            <p className="text-amber-700">
              No portal ID yet — sync will use the public RESO endpoint
              until the ready webhook fires. If that 401s, paste the
              Portal ID (igXXXXX) from manage.youriguide.com.
            </p>
          ) : null}
          {job ? (
            <p>
              Job:{" "}
              <span className="text-realtor-text/90">{job.status}</span>
              {job.work_order_id ? (
                <>
                  {" · "}Work order:{" "}
                  <code className="rounded bg-white/65 px-1 py-0.5 text-[11px] text-realtor-text/90">
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
            className="mt-1 text-[11px] text-realtor-muted/80 underline hover:text-red-800 disabled:opacity-50"
          >
            Clear iGuide link
          </button>
        </div>
      ) : null}

      <details className="rounded-xl border border-realtor-primary/15 bg-white/65 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-realtor-text">
          Photo ZIP download links
        </summary>
        <form
          className="mt-3 space-y-3"
          action={(formData) => {
            setPhotoError(null);
            setPhotoMessage(null);
            startPhotoSaving(async () => {
              const res = await saveIGuidePhotoDownloads(bookingId, formData);
              if (!res.ok) {
                setPhotoError(res.error ?? "Could not save photo downloads.");
                return;
              }
              setPhotoMessage("Photo download links saved.");
            });
          }}
        >
          <p className="text-xs leading-relaxed text-realtor-muted">
            Older iGUIDEs may only give us the tour and PDFs when you paste a
            public link. If the realtor portal is missing photo downloads, copy
            the Low-Res Image Gallery and Hi-Res Image Gallery links from the
            iGUIDE report and save them here.
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="space-y-1 text-xs text-realtor-muted">
              <span>MLS / low-res photo ZIP</span>
              <input
                name="mls_photo_zip_url"
                type="url"
                defaultValue={initialPhotoDownloads.mls ?? ""}
                placeholder="https://youriguide.com/.../doc/gallery-low-res.zip"
                className="w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text placeholder-realtor-muted/60 focus:outline-none focus:ring-2 focus:ring-realtor-primary/60"
              />
            </label>
            <label className="space-y-1 text-xs text-realtor-muted">
              <span>High-res photo ZIP</span>
              <input
                name="high_res_photo_zip_url"
                type="url"
                defaultValue={initialPhotoDownloads.highRes ?? ""}
                placeholder="https://youriguide.com/.../doc/gallery.zip"
                className="w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text placeholder-realtor-muted/60 focus:outline-none focus:ring-2 focus:ring-realtor-primary/60"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={photoSaving}
            className="rounded-full bg-realtor-primary px-3 py-2 text-sm font-semibold text-white hover:bg-realtor-primary/90 disabled:opacity-50"
          >
            {photoSaving ? "Saving…" : "Save photo downloads"}
          </button>
          {photoError ? (
            <p className="text-sm text-red-700" role="alert">
              {photoError}
            </p>
          ) : null}
          {photoMessage ? (
            <p className="text-xs text-emerald-700">{photoMessage}</p>
          ) : null}
        </form>
      </details>

      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {okMessage ? (
        <p className="text-xs text-emerald-700">{okMessage}</p>
      ) : null}
    </div>
  );
}
