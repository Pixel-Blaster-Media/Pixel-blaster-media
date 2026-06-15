"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AutoenhanceBatchSummary,
  AutoenhancePreparedUpload,
} from "@/lib/integrations/autoenhance/workflow";

type PrepareResponse =
  | {
      ok: true;
      batch: AutoenhanceBatchSummary;
      uploads: AutoenhancePreparedUpload[];
    }
  | { ok: false; error: string };

type BatchResponse =
  | { ok: true; batch: AutoenhanceBatchSummary }
  | { ok: false; error: string };

const ACCEPTED_PHOTO_TYPES = [
  "image/*",
  ".arw",
  ".cr2",
  ".cr3",
  ".nef",
  ".nrw",
  ".raf",
  ".rw2",
  ".orf",
  ".dng",
  ".raw",
].join(",");

export default function AutoenhanceSection({
  bookingId,
  iguidePortalId,
  initialBatches,
}: {
  bookingId: string;
  iguidePortalId: string | null;
  initialBatches: AutoenhanceBatchSummary[];
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploadMode, setUploadMode] = useState<"hdr" | "single">("hdr");
  const [bracketsPerImage, setBracketsPerImage] = useState(3);
  const [enhanceType, setEnhanceType] = useState("warm");
  const [privacy, setPrivacy] = useState(true);
  const [skyReplacement, setSkyReplacement] = useState(false);
  const [greenGrass, setGreenGrass] = useState(false);
  const [fireInFireplaces, setFireInFireplaces] = useState(false);
  const [batches, setBatches] = useState(initialBatches);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<string | null>(null);

  const activeBatch = useMemo(
    () =>
      batches.find((batch) =>
        ["uploading", "processing", "waiting_for_iguide", "attention"].includes(
          batch.status,
        ),
      ) ?? batches[0],
    [batches],
  );

  useEffect(() => {
    if (!activeBatch) return;
    if (!["uploading", "processing"].includes(activeBatch.status)) return;
    pollingRef.current = activeBatch.id;
    const interval = window.setInterval(() => {
      if (pollingRef.current) {
        void refreshBatch(pollingRef.current, { quiet: true });
      }
    }, 20_000);
    return () => {
      window.clearInterval(interval);
      pollingRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBatch?.id, activeBatch?.status]);

  async function uploadAndEnhance() {
    if (!files.length) {
      setError("Pick at least one photo first.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage("Creating Autoenhance order...");
    try {
      const prepared = await apiJson<PrepareResponse>(
        `/api/admin/bookings/${bookingId}/autoenhance/prepare`,
        {
          method: "POST",
          body: JSON.stringify({
            fileNames: files.map((file) => file.name),
            uploadMode,
            bracketsPerImage,
            enhanceType,
            privacy,
            skyReplacement,
            greenGrass,
            fireInFireplaces,
          }),
        },
      );
      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }

      setBatches((current) => upsertBatch(current, prepared.batch));
      const uploadedBracketIds: string[] = [];
      const uploadedImageIds: string[] = [];
      for (const [index, upload] of prepared.uploads.entries()) {
        const file = files[index];
        if (!file) continue;
        setMessage(`Uploading ${file.name} to Autoenhance...`);
        const put = await fetch(upload.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: file,
        });
        if (!put.ok) {
          const body = await put.text().catch(() => "");
          throw new Error(
            `Upload failed for ${file.name}: ${put.status} ${body.slice(0, 160)}`,
          );
        }
        if (upload.uploadKind === "bracket" && upload.bracketId) {
          uploadedBracketIds.push(upload.bracketId);
        } else {
          uploadedImageIds.push(upload.imageId);
        }
      }

      setMessage("Starting Autoenhance processing...");
      const processed = await apiJson<BatchResponse>(
        `/api/admin/bookings/${bookingId}/autoenhance/process`,
        {
          method: "POST",
          body: JSON.stringify({
            batchId: prepared.batch.id,
            uploadedBracketIds,
            uploadedImageIds,
          }),
        },
      );
      if (!processed.ok) {
        setError(processed.error);
        return;
      }
      setFiles([]);
      setBatches((current) => upsertBatch(current, processed.batch));
      setMessage(
        processed.batch.iguidePortalId
          ? "Processing started. Finished photos will push to iGUIDE automatically."
          : "Processing started. Link an iGUIDE Portal ID and refresh to push finished photos.",
      );
      pollingRef.current = processed.batch.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function refreshBatch(
    batchId: string,
    options: { quiet?: boolean } = {},
  ) {
    if (!options.quiet) {
      setBusy(true);
      setError(null);
      setMessage("Checking Autoenhance and iGUIDE...");
    }
    try {
      const refreshed = await apiJson<BatchResponse>(
        `/api/admin/bookings/${bookingId}/autoenhance/refresh`,
        {
          method: "POST",
          body: JSON.stringify({ batchId }),
        },
      );
      if (!refreshed.ok) {
        if (!options.quiet) setError(refreshed.error);
        return;
      }
      setBatches((current) => upsertBatch(current, refreshed.batch));
      if (!options.quiet) {
        setMessage(statusMessage(refreshed.batch));
      }
    } catch (err) {
      if (!options.quiet) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!options.quiet) setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-realtor-primary/20 bg-white/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-realtor-primary">
            Autoenhance photos
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-realtor-muted">
            Upload bracketed photos here. The app sends them to Autoenhance,
            watches for finished edits, then pushes completed JPEGs into the
            linked iGUIDE gallery automatically.
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
            iguidePortalId
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {iguidePortalId ? "Auto-push ready" : "Link iGUIDE first"}
        </span>
      </div>

      {!iguidePortalId ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          You can still upload and process photos, but the automatic iGUIDE push
          waits until this booking has a Portal ID from the iGUIDE section above.
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1.4fr_0.8fr_0.8fr]">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
            Photos
          </span>
          <input
            type="file"
            multiple
            accept={ACCEPTED_PHOTO_TYPES}
            onChange={(event) =>
              setFiles(Array.from(event.currentTarget.files ?? []))
            }
            className="mt-1 w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text file:mr-3 file:rounded-full file:border-0 file:bg-realtor-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
            Upload type
          </span>
          <select
            value={uploadMode}
            onChange={(event) =>
              setUploadMode(event.currentTarget.value === "single" ? "single" : "hdr")
            }
            className="admin-input mt-1"
          >
            <option value="hdr">HDR brackets</option>
            <option value="single">Single photos</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
            Grouping
          </span>
          <select
            value={bracketsPerImage}
            onChange={(event) => setBracketsPerImage(Number(event.currentTarget.value))}
            disabled={uploadMode !== "hdr"}
            className="admin-input mt-1"
          >
            <option value={3}>3 brackets = 1 photo</option>
            <option value={0}>Auto-detect</option>
            <option value={5}>5 brackets = 1 photo</option>
            <option value={7}>7 brackets = 1 photo</option>
            <option value={1}>1 file = 1 photo</option>
          </select>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,220px)_1fr]">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
            Style
          </span>
          <select
            value={enhanceType}
            onChange={(event) => setEnhanceType(event.currentTarget.value)}
            className="admin-input mt-1"
          >
            <option value="warm">Warm</option>
            <option value="neutral">Neutral</option>
            <option value="modern">Modern</option>
            <option value="property">Property</option>
            <option value="property_usa">Property USA</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-3 rounded-2xl border border-realtor-primary/10 bg-realtor-primary/5 p-3">
          <Toggle checked={privacy} label="Blur faces / plates" onChange={setPrivacy} />
          <Toggle
            checked={skyReplacement}
            label="Sky replacement"
            onChange={setSkyReplacement}
          />
          <Toggle checked={greenGrass} label="Green grass" onChange={setGreenGrass} />
          <Toggle
            checked={fireInFireplaces}
            label="Light fireplaces"
            onChange={setFireInFireplaces}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={uploadAndEnhance}
        disabled={busy || !files.length}
        className="w-full rounded-full bg-realtor-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-realtor-primary/90 disabled:cursor-not-allowed disabled:opacity-55"
      >
        {busy ? "Working..." : "Upload + enhance"}
      </button>

      {message ? <p className="text-xs text-emerald-800">{message}</p> : null}
      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      ) : null}

      {batches.length ? (
        <div className="space-y-2">
          {batches.map((batch) => (
            <BatchCard
              key={batch.id}
              batch={batch}
              busy={busy}
              onRefresh={() => refreshBatch(batch.id)}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-realtor-primary/20 px-3 py-3 text-xs text-realtor-muted">
          No Autoenhance batches yet for this booking.
        </p>
      )}
    </section>
  );
}

function BatchCard({
  batch,
  busy,
  onRefresh,
}: {
  batch: AutoenhanceBatchSummary;
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-2xl border border-realtor-primary/10 bg-realtor-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-realtor-text">
            {batch.orderName}
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-realtor-muted">
            {batch.orderId}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          className="rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <MiniStat label="Status" value={humanStatus(batch.status)} />
        <MiniStat label="Finished" value={`${batch.finishedImageIds.length}`} />
        <MiniStat label="In iGUIDE" value={`${batch.uploadedCount}`} />
        <MiniStat label="Needs help" value={`${batch.failedCount}`} />
      </div>
      {batch.lastError ? (
        <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {batch.lastError}
        </p>
      ) : null}
      {batch.uploads.length ? (
        <div className="mt-3 space-y-1 text-xs text-realtor-muted">
          {batch.uploads.slice(0, 4).map((upload) => (
            <p key={`${upload.imageId}-${upload.filename}`}>
              {upload.status === "uploaded" ? "Added" : "Issue"}:{" "}
              <span className="text-realtor-text">{upload.filename}</span>
              {upload.warning ? ` · ${upload.warning}` : ""}
              {upload.error ? ` · ${upload.error}` : ""}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-realtor-primary/10 bg-white/80 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-realtor-muted">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-realtor-text">{value}</p>
    </div>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-realtor-text">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="h-4 w-4 rounded border-realtor-primary/30 text-realtor-primary focus:ring-realtor-primary"
      />
      {label}
    </label>
  );
}

function upsertBatch(
  batches: AutoenhanceBatchSummary[],
  next: AutoenhanceBatchSummary,
) {
  const existing = batches.filter((batch) => batch.id !== next.id);
  return [next, ...existing].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

function humanStatus(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusMessage(batch: AutoenhanceBatchSummary) {
  if (batch.status === "iguide_uploaded") {
    return `Done. ${batch.uploadedCount} photo(s) were added to iGUIDE.`;
  }
  if (batch.status === "waiting_for_iguide") {
    return "Autoenhance is done. Link an iGUIDE Portal ID, then refresh.";
  }
  if (batch.status === "attention") {
    return "This batch needs attention. Check the warning below.";
  }
  return "Still processing. The page will keep checking while it stays open.";
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, { ...init, headers });
  const body = (await response.json().catch(() => null)) as T | null;
  if (!body) {
    return {
      ok: false,
      error: `Could not read response from ${url}.`,
    } as T;
  }
  return body;
}
