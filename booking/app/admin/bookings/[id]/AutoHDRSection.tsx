"use client";

import { useEffect, useState } from "react";

import type { AutoHDRJob } from "@/lib/integrations/autohdr/application-core";
import { uploadAutoHDRFiles } from "@/lib/integrations/autohdr/browser-upload";
import { AUTOHDR_MODELS, type AutoHDRModel } from "@/lib/integrations/autohdr/contract";
import type { AutoHDRPreparedUpload } from "@/lib/integrations/autohdr/upload-contract";

type JobResponse =
  | { ok: true; job: AutoHDRJob }
  | { ok: false; error: string; code: string };
type PrepareResponse =
  | { ok: true; job: AutoHDRJob; uploads: AutoHDRPreparedUpload[] }
  | { ok: false; error: string; code: string };

const ACCEPTED_FILES = [
  "image/*",
  ".arw",
  ".cr2",
  ".cr3",
  ".dng",
  ".nef",
  ".orf",
  ".raf",
  ".raw",
  ".rw2",
].join(",");

export default function AutoHDRSection({
  bookingId,
  initialJobs,
}: {
  bookingId: string;
  initialJobs: AutoHDRJob[];
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [jobs, setJobs] = useState(initialJobs);
  const [modelSelection, setModelSelection] = useState<AutoHDRModel>("Classic-V4");
  const [perspectiveCorrection, setPerspectiveCorrection] = useState(true);
  const [retainOriginalSky, setRetainOriginalSky] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
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
    if (!files.length) {
      setError("Pick at least one photo first.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage("Preparing secure AutoHDR uploads…");
    try {
      const prepared = await apiJson<PrepareResponse>(
        `/api/admin/bookings/${bookingId}/autohdr/prepare`,
        {
          manifest: files.map((file) => ({
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
          })),
          style: {
            modelSelection,
            perspectiveCorrection,
            retainOriginalSky,
          },
        },
      );
      if (!prepared.ok) throw new Error(prepared.error);
      setJobs((current) => upsertJob(current, prepared.job));
      setMessage("Uploading directly to AutoHDR…");
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
      setMessage("Processing at AutoHDR. This panel will refresh automatically.");
    } catch (cause) {
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

  async function requestRetrieval(jobId: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await apiJson<JobResponse>(
        `/api/admin/bookings/${bookingId}/autohdr/retrieve`,
        { jobId },
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setJobs((current) => upsertJob(current, result.job));
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
            Send a bounded photo set for editing. Finished provider work remains
            review pending until an administrator explicitly retrieves it.
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
            disabled={busy}
            onChange={(event) => setFiles(Array.from(event.currentTarget.files ?? []))}
            className="mt-1 w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text file:mr-3 file:rounded-full file:border-0 file:bg-realtor-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
            Style
          </span>
          <select
            value={modelSelection}
            disabled={busy}
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
            disabled={busy}
            onChange={(event) => setPerspectiveCorrection(event.currentTarget.checked)}
          />
          Perspective correction
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={retainOriginalSky}
            disabled={busy}
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
      {message ? <p role="status" className="text-xs text-realtor-muted">{message}</p> : null}
      {error ? (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || files.length === 0}
          onClick={() => void prepareUploadAndFinalize()}
          className="rounded-full bg-realtor-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Working…" : `Send ${files.length || ""} photo${files.length === 1 ? "" : "s"}`}
        </button>
        {activeJob?.state === "processing" ? (
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
          <button
            type="button"
            disabled={busy}
            onClick={() => void requestRetrieval(activeJob.id)}
            className="rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900 disabled:opacity-50"
          >
            Retrieve for review
          </button>
        ) : null}
      </div>
    </section>
  );
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
