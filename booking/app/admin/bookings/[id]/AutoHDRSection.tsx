"use client";

import { useEffect, useState } from "react";

import type { AutoHDRJob } from "@/lib/integrations/autohdr/application-core";
import {
  CanonicalBrowserUploadError,
  hashAutoHDRSourceFiles,
  uploadAutoHDRFiles,
  uploadCanonicalAutoHDRSources,
  validateAutoHDRSourceFiles,
} from "@/lib/integrations/autohdr/browser-upload";
import type { CanonicalBrowserUploadResult } from "@/lib/integrations/autohdr/browser-upload";
import { AUTOHDR_MODELS, type AutoHDRModel } from "@/lib/integrations/autohdr/contract";
import type { AutoHDRCanonicalSource } from "@/lib/integrations/autohdr/database-contract";
import type { CanonicalSourcePreparedUpload } from "@/lib/integrations/autohdr/source-upload";
import type { AutoHDRSourceIngestionResult } from "@/lib/integrations/autohdr/source-ingestion-core";
import type { AutoHDRPreparedUpload } from "@/lib/integrations/autohdr/upload-contract";

type JobResponse =
  | { ok: true; job: AutoHDRJob }
  | { ok: false; error: string; code: string };
type PrepareResponse =
  | { ok: true; job: AutoHDRJob; uploads: AutoHDRPreparedUpload[] }
  | { ok: false; error: string; code: string };
type SourcePrepareResponse =
  | { ok: true; sources: CanonicalSourcePreparedUpload[] }
  | { ok: false; error: string; code: string };
type SourceAcceptResponse =
  | { ok: true; sources: AutoHDRCanonicalSource[]; results: AutoHDRSourceIngestionResult[] }
  | { ok: false; error: string; code: string };

const ACCEPTED_FILES = "image/jpeg,image/png,.jpg,.jpeg,.png";

export default function AutoHDRSection({
  bookingId,
  initialJobs,
  mutationEnabled,
}: {
  bookingId: string;
  initialJobs: AutoHDRJob[];
  mutationEnabled: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [jobs, setJobs] = useState(initialJobs);
  const [modelSelection, setModelSelection] = useState<AutoHDRModel>("Classic-V4");
  const [perspectiveCorrection, setPerspectiveCorrection] = useState(true);
  const [retainOriginalSky, setRetainOriginalSky] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sourceRequestId, setSourceRequestId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [sourceResults, setSourceResults] = useState<AutoHDRSourceIngestionResult[]>([]);
  const [browserResults, setBrowserResults] = useState<CanonicalBrowserUploadResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeJob = jobs[0] ?? null;

  useEffect(() => {
    if (activeJob?.state !== "processing") return;
    const refreshQuietly = async () => {
      try {
        const result = await apiJson<JobResponse>(
          `/api/admin/bookings/${bookingId}/autohdr/refresh`,
          { jobId: activeJob.id },
        );
        if (result.ok) {
          setJobs((current) => upsertJob(current, result.job));
        }
      } catch {
        // A later poll or explicit refresh can safely retry this read-only check.
      }
    };
    const interval = window.setInterval(() => {
      void refreshQuietly();
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [activeJob?.id, activeJob?.state, bookingId]);

  async function prepareUploadAndFinalize() {
    if (!mutationEnabled) {
      setError("AutoHDR uploads are disabled until every production prerequisite is verified.");
      return;
    }
    if (!files.length) {
      setError("Pick at least one photo first.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage("Hashing source photos…");
    try {
      const requestId = sourceRequestId ?? crypto.randomUUID();
      if (!sourceRequestId) setSourceRequestId(requestId);
      const sourceManifest = await hashAutoHDRSourceFiles(files);
      setMessage("Preparing private Pixel source storage…");
      const sourcePrepared = await apiJson<SourcePrepareResponse>(
        `/api/admin/bookings/${bookingId}/autohdr/source/prepare`,
        { manifest: sourceManifest, requestId },
      );
      if (!sourcePrepared.ok) throw new Error(sourcePrepared.error);
      setMessage("Uploading originals to private Pixel storage…");
      setProgress({ completed: 0, total: files.length });
      const uploadResults = await uploadCanonicalAutoHDRSources(files, sourcePrepared.sources, {
        concurrency: 4,
        onProgress: (completed, total) => setProgress({ completed, total }),
      });
      setBrowserResults(uploadResults);
      setMessage("Verifying canonical source uploads…");
      const sourceAccepted = await apiJson<SourceAcceptResponse>(
        `/api/admin/bookings/${bookingId}/autohdr/source/accept`,
        { sources: sourcePrepared.sources.map(withoutUploadCapability), requestId },
      );
      if (!sourceAccepted.ok) throw new Error(sourceAccepted.error);
      setSourceResults(sourceAccepted.results);
      const unresolved = sourceAccepted.results.filter((result) => result.status !== "accepted");
      if (unresolved.length) {
        setProgress({ completed: sourceAccepted.sources.length, total: files.length });
        throw new Error(
          `${sourceAccepted.sources.length} of ${files.length} sources are accepted. Retry the unchanged selection to reconcile the remainder.`,
        );
      }
      setMessage("Preparing secure AutoHDR uploads…");
      const prepared = await apiJson<PrepareResponse>(
        `/api/admin/bookings/${bookingId}/autohdr/prepare`,
        {
          manifest: sourceAccepted.sources,
          style: {
            modelSelection,
            perspectiveCorrection,
            retainOriginalSky,
          },
        },
      );
      if (!prepared.ok) throw new Error(prepared.error);
      setJobs((current) => upsertJob(current, prepared.job));
      setMessage("Uploading accepted sources to AutoHDR…");
      setProgress({ completed: 0, total: files.length });
      await uploadAutoHDRFiles(files, prepared.uploads, {
        concurrency: 4,
        onProgress: (completed, total) => setProgress({ completed, total }),
      });
      setMessage("Starting AutoHDR processing…");
      const finalized = await apiJson<JobResponse>(
        `/api/admin/bookings/${bookingId}/autohdr/finalize`,
        { jobId: prepared.job.id },
      );
      if (!finalized.ok) throw new Error(finalized.error);
      setJobs((current) => upsertJob(current, finalized.job));
      setFiles([]);
      setSourceRequestId(null);
      setMessage("Processing at AutoHDR. This panel will refresh automatically.");
    } catch (cause) {
      if (cause instanceof CanonicalBrowserUploadError) setBrowserResults(cause.results);
      setError(publicClientError(cause));
      setMessage(null);
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  async function refresh(jobId: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await apiJson<JobResponse>(
        `/api/admin/bookings/${bookingId}/autohdr/refresh`,
        { jobId },
      );
      if (!result.ok) throw new Error(result.error);
      setJobs((current) => upsertJob(current, result.job));
      setMessage(statusLabel(result.job.state));
    } catch (cause) {
      setError(publicClientError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-realtor-primary/20 bg-white/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-realtor-primary">
            AutoHDR
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-realtor-muted">
            Send a bounded JPEG/PNG set for editing. Finished provider work is
            held at the provider until secure private ingestion is enabled.
          </p>
        </div>
        <span className="rounded-full border border-realtor-primary/15 bg-realtor-surface px-3 py-1 text-xs font-semibold text-realtor-primary">
          {activeJob ? statusLabel(activeJob.state) : "New job"}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.5fr_0.8fr]">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
            Photos
          </span>
          <input
            type="file"
            multiple
            accept={ACCEPTED_FILES}
            disabled={!mutationEnabled || busy}
            onChange={(event) => {
              const selected = Array.from(event.currentTarget.files ?? []);
              try {
                validateAutoHDRSourceFiles(selected);
                setFiles(selected);
                setSourceRequestId(null);
                setSourceResults([]);
                setBrowserResults([]);
                setError(null);
              } catch (cause) {
                setFiles([]);
                setSourceRequestId(null);
                setSourceResults([]);
                setBrowserResults([]);
                setError(publicClientError(cause));
                event.currentTarget.value = "";
              }
            }}
            className="mt-1 w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text file:mr-3 file:rounded-full file:border-0 file:bg-realtor-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
            Style
          </span>
          <select
            value={modelSelection}
            disabled={!mutationEnabled || busy}
            onChange={(event) => setModelSelection(event.currentTarget.value as AutoHDRModel)}
            className="admin-input mt-1"
          >
            {AUTOHDR_MODELS.map((model) => <option key={model}>{model}</option>)}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-realtor-text">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={perspectiveCorrection}
            disabled={!mutationEnabled || busy}
            onChange={(event) => setPerspectiveCorrection(event.currentTarget.checked)}
          />
          Perspective correction
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={retainOriginalSky}
            disabled={!mutationEnabled || busy}
            onChange={(event) => setRetainOriginalSky(event.currentTarget.checked)}
          />
          Retain original sky
        </label>
      </div>

      {progress ? (
        <p role="status" className="text-xs text-realtor-muted">
          Uploaded {progress.completed} of {progress.total}
        </p>
      ) : null}
      {sourceResults.length ? (
        <p role="status" className="text-xs text-realtor-muted">
          Source storage: {sourceResults.filter((result) => result.status === "accepted").length} accepted,
          {" "}{sourceResults.filter((result) => result.status === "reconciliation_required").length} awaiting reconciliation.
        </p>
      ) : null}
      {browserResults.length ? (
        <p role="status" className="text-xs text-realtor-muted">
          Browser upload: {browserResults.filter((result) => result.attempted).length} attempted,
          {" "}{browserResults.filter((result) => result.status === "reconciliation_candidate").length} awaiting server reconciliation.
        </p>
      ) : null}
      {message ? <p role="status" className="text-xs text-realtor-muted">{message}</p> : null}
      {error ? (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!mutationEnabled || busy || files.length === 0}
          onClick={() => void prepareUploadAndFinalize()}
          className="rounded-full bg-realtor-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Working…" : `Upload + edit ${files.length || ""} photo${files.length === 1 ? "" : "s"}`}
        </button>
        {mutationEnabled && activeJob?.state === "processing" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void refresh(activeJob.id)}
            className="rounded-full border border-realtor-primary/20 px-4 py-2 text-xs font-semibold text-realtor-primary disabled:opacity-50"
          >
            Refresh status
          </button>
        ) : null}
        {activeJob?.state === "ready" ? (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900">
            Secure ingestion not enabled
          </span>
        ) : null}
      </div>
    </section>
  );
}

function withoutUploadCapability(source: CanonicalSourcePreparedUpload): AutoHDRCanonicalSource {
  const { upload: _upload, ...identity } = source;
  return identity;
}

function upsertJob(current: AutoHDRJob[], job: AutoHDRJob): AutoHDRJob[] {
  return [job, ...current.filter((candidate) => candidate.id !== job.id)];
}

function statusLabel(state: AutoHDRJob["state"]): string {
  const labels: Record<AutoHDRJob["state"], string> = {
    claimed: "Claimed",
    preparing: "Preparing",
    awaiting_upload: "Awaiting upload",
    finalizing: "Finalizing",
    processing: "Processing",
    ready: "Review pending ingestion",
    retrieving: "Retrieving",
    review_pending: "Review pending",
    retryable: "Needs attention",
    reconciliation_required: "Needs reconciliation",
    rejected: "Stopped",
  };
  return labels[state];
}

async function apiJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json() as T;
  return value;
}

function publicClientError(cause: unknown): string {
  return cause instanceof Error && cause.message.length <= 500
    ? cause.message
    : "AutoHDR request could not be completed.";
}
