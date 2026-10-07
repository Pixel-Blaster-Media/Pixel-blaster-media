"use client";

import { useEffect, useRef, useState } from "react";
import type { UploadOptions } from "tus-js-client";
import { catalogFileFingerprint, CATALOG_UPLOAD_CHUNK_BYTES, validCatalogUploadSize } from "@/lib/booking/catalog-upload-policy";
import { configureCatalogUploadRequest } from "@/lib/booking/catalog-upload-transport";
import { deleteCatalogExample } from "./example-actions";

type Transfer = { start(): void; abort(terminate?: boolean): Promise<void> };
type Phase = "idle" | "preparing" | "uploading" | "paused" | "processing" | "processing_pending" | "cancelling" | "cancel_failed";
type Props = {
  catalogItemId: string; onBusyChange: (message: string | null) => void; onComplete: () => void;
  createTransfer?: (file: File, options: UploadOptions) => Promise<Transfer>;
};
async function createTransfer(file: File, options: UploadOptions): Promise<Transfer> {
  const { Upload } = await import("tus-js-client");
  return new Upload(file, options);
}
async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try { const value = await response.json(); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}

export default function CatalogVideoUploader(props: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const transfer = useRef<Transfer | null>(null);
  const exampleId = useRef<string | null>(null);
  const expiry = useRef(0);
  const alive = useRef(true);
  const generation = useRef(0);
  const callbacks = useRef(props);
  callbacks.current = props;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; generation.current += 1;
      void transfer.current?.abort();
      callbacks.current.onBusyChange(null);
    };
  }, []);
  const changePhase = (next: Phase, label: string | null) => {
    if (!alive.current) return;
    phaseRef.current = next;
    setPhase(next); callbacks.current.onBusyChange(label);
  };
  const checkProcessing = async () => {
    const run = generation.current;
    setError(null); changePhase("processing", "Processing video…");
    for (let attempt = 0; attempt < 40 && alive.current && generation.current === run; attempt += 1) {
      try {
        const response = await fetch(`/api/admin/catalog-examples/${encodeURIComponent(exampleId.current!)}/complete`, {
          method: "POST", signal: AbortSignal.timeout(15_000),
        });
        const body = await responseJson(response);
        if (!alive.current || generation.current !== run) return;
        if (response.ok && body.ok === true) {
          callbacks.current.onBusyChange(null); callbacks.current.onComplete(); return;
        }
        if (response.status !== 202) throw new Error(typeof body.error === "string" ? body.error : "Could not check processing yet.");
      } catch (caught) {
        if (!alive.current || generation.current !== run) return;
        setError(caught instanceof Error ? caught.message : "Could not check processing yet.");
        changePhase("processing_pending", null); return;
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    if (alive.current && generation.current === run) changePhase("processing_pending", null);
  };
  const start = async () => {
    if (phaseRef.current !== "idle") return;
    if (!file || !file.type.startsWith("video/")) return setError("Choose a video file.");
    if (!title.trim()) return setError("Add a title for the example.");
    if (!validCatalogUploadSize(file.size)) return setError("Video uploads must be 1 GB or smaller.");
    setError(null); setPercent(0);
    const run = ++generation.current;
    changePhase("preparing", "Preparing secure upload…");
    try {
      const fingerprint = await catalogFileFingerprint(file);
      const response = await fetch("/api/admin/catalog-examples/upload", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protocol: "tus", size: file.size, fingerprint, catalogItemId: props.catalogItemId,
          title, description, idempotencyKey: crypto.randomUUID() }), signal: AbortSignal.timeout(45_000),
      });
      const body = await responseJson(response);
      if (!alive.current || generation.current !== run) return;
      if (!response.ok || typeof body.uploadUrl !== "string" || typeof body.exampleId !== "string"
          || typeof body.expiresAt !== "string" || !Number.isFinite(Date.parse(body.expiresAt))) {
        throw new Error(typeof body.error === "string" ? body.error : "Could not prepare the upload. Retry with the same file.");
      }
      exampleId.current = body.exampleId; expiry.current = Date.parse(body.expiresAt);
      const upload = await (props.createTransfer ?? createTransfer)(file, {
        uploadUrl: body.uploadUrl, uploadSize: file.size, chunkSize: CATALOG_UPLOAD_CHUNK_BYTES,
        retryDelays: [0, 1000, 3000, 5000, 10_000], parallelUploads: 1,
        storeFingerprintForResuming: false, removeFingerprintOnSuccess: true,
        onBeforeRequest(request) {
          if (Date.now() >= expiry.current) throw new Error("Upload expired.");
          const xhr = request.getUnderlyingObject();
          if (typeof XMLHttpRequest !== "undefined" && xhr instanceof XMLHttpRequest) configureCatalogUploadRequest(xhr);
        },
        onShouldRetry(caught) {
          if (Date.now() >= expiry.current) return false;
          const status = caught.originalResponse?.getStatus() ?? 0;
          return status === 0 || status === 408 || status === 409 || status === 429 || status >= 500;
        },
        onProgress(sent, total) {
          if (alive.current && generation.current === run && total > 0) setPercent(Math.max(0, Math.min(100, Math.floor(sent / total * 100))));
        },
        onError() {
          if (!alive.current || generation.current !== run) return;
          setError("The upload stopped. Resume to retry. If the link expired, cancel and start again.");
          changePhase("paused", "Upload paused.");
        },
        onSuccess() {
          if (!alive.current || generation.current !== run) return;
          setPercent(100); void checkProcessing();
        },
      });
      if (!alive.current || generation.current !== run) { await upload.abort(); return; }
      transfer.current = upload;
      changePhase("uploading", body.resumed ? "Resuming video upload…" : "Uploading video…"); upload.start();
    } catch (caught) {
      if (!alive.current || generation.current !== run) return;
      setError(caught instanceof Error ? caught.message : "Could not start upload."); changePhase("idle", null);
    }
  };
  const pause = async () => {
    if (phaseRef.current !== "uploading") return;
    try { await transfer.current?.abort(); if (phaseRef.current === "uploading") changePhase("paused", "Upload paused."); }
    catch { setError("Could not pause the upload. Try again."); }
  };
  const resume = () => {
    if (Date.now() >= expiry.current) return setError("This upload expired. Cancel it before starting again.");
    setError(null); changePhase("uploading", "Resuming video upload…"); transfer.current?.start();
  };
  const cancel = async () => {
    if (!exampleId.current) return;
    generation.current += 1; changePhase("cancelling", "Cancelling upload…");
    try {
      await transfer.current?.abort();
      const result = await deleteCatalogExample(exampleId.current);
      if (!alive.current) return;
      if (!result.ok) throw new Error(result.error ?? "Could not cancel the upload safely.");
      callbacks.current.onBusyChange(null); callbacks.current.onComplete();
    } catch (caught) {
      if (!alive.current) return;
      setError(caught instanceof Error ? caught.message : "Could not cancel the upload."); changePhase("cancel_failed", null);
    }
  };
  const locked = phase !== "idle";
  return <form onSubmit={event => { event.preventDefault(); void start(); }} className="mt-3 grid min-w-0 gap-3 border-t border-realtor-primary/10 pt-3">
    <label className="grid gap-1 text-xs">Example title
      <input value={title} onChange={event => setTitle(event.target.value)} maxLength={120} required disabled={locked}
        className="w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm" />
    </label>
    <label className="grid gap-1 text-xs">Short explanation (optional)
      <input value={description} onChange={event => setDescription(event.target.value)} maxLength={500} disabled={locked}
        className="w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm" />
    </label>
    <label className="grid gap-1 text-xs">Video file
      <input type="file" accept="video/*" disabled={locked} onChange={event => setFile(event.target.files?.[0] ?? null)} className="block w-full min-w-0 text-xs" />
    </label>
    <p className="text-[11px] text-realtor-muted">Maximum 1 GB and 10 minutes. Uploads can resume for six hours: after refreshing, select the same file again. Playback is optimized automatically, up to 1080p.</p>
    {phase !== "idle" && phase !== "preparing" ? <div className="flex items-center gap-2"><progress value={percent} max={100} aria-label="Video upload progress" className="min-w-0 flex-1" /><span className="text-xs">{percent}%</span></div> : null}
    <div className="flex flex-wrap gap-2">
      {phase === "idle" ? <button type="submit" className="tap-target rounded-full bg-realtor-primary px-4 py-2 text-xs font-semibold text-white">Upload video</button> : null}
      {phase === "uploading" ? <button type="button" onClick={() => void pause()} className="tap-target rounded-full border px-4 py-2 text-xs">Pause upload</button> : null}
      {phase === "paused" ? <button type="button" onClick={resume} className="tap-target rounded-full border px-4 py-2 text-xs">Resume upload</button> : null}
      {phase === "processing_pending" ? <button type="button" onClick={() => void checkProcessing()} className="tap-target rounded-full border px-4 py-2 text-xs">Check processing</button> : null}
      {phase === "cancel_failed" ? <button type="button" onClick={() => callbacks.current.onComplete()} className="tap-target rounded-full border px-4 py-2 text-xs">Close uploader</button> : null}
      {exampleId.current && !["preparing", "cancelling"].includes(phase) ? <button type="button" onClick={() => void cancel()} className="tap-target rounded-full border px-4 py-2 text-xs">Cancel upload</button> : null}
    </div>
    {phase === "processing_pending" ? <p role="status" className="text-xs">Your upload was received. It stays hidden until processing finishes. Check again shortly.</p> : null}
    {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
  </form>;
}
