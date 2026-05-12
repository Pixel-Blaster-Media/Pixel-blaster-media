"use client";

import { useState, useTransition } from "react";

import {
  diagnosePrepareDownload,
  testCreateListing,
  testFotelloShareLink,
  testGetEnhance,
  testUploadAndEnhance,
} from "./actions";

type EnhanceResult = {
  id: string;
  status: string;
  enhancedImageUrl: string | null;
  enhancedImageUrlExpires: string | null;
};

type DeliveryTestResult = {
  listingId: string;
  shareUrl: string;
  downloadUrl: string | null;
  totalItems: number | null;
  processedItems: number | null;
};

type PrepareDownloadAttempt = {
  label: string;
  endpoint: string;
  ok: boolean;
  status: number | null;
  body: string;
};

export default function FotelloTestClient() {
  const [listingName, setListingName] = useState("Fotello API test");
  const [listingId, setListingId] = useState("");
  const [enhanceId, setEnhanceId] = useState("");
  const [shotType, setShotType] = useState<"interior" | "exterior">("interior");
  const [files, setFiles] = useState<File[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<EnhanceResult | null>(null);
  const [deliveryResult, setDeliveryResult] =
    useState<DeliveryTestResult | null>(null);
  const [downloadAttempts, setDownloadAttempts] = useState<
    PrepareDownloadAttempt[]
  >([]);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [diagnosingZip, setDiagnosingZip] = useState(false);

  function append(message: string) {
    setLog((items) => [`${new Date().toLocaleTimeString()} · ${message}`, ...items].slice(0, 30));
  }

  function createListingOnly() {
    startTransition(() => {
      void (async () => {
        append("Creating Fotello listing...");
        const res = await testCreateListing(listingName);
        if (!res.ok) {
          append(`Listing failed: ${res.error}`);
          return;
        }
        setListingId(res.id);
        append(`Listing created: ${res.id}`);
      })();
    });
  }

  async function uploadAndEnhance() {
    if (!files.length) {
      append("Pick at least one photo first.");
      return;
    }
    setUploading(true);
    try {
      append("Uploading server-side to avoid browser CORS...");
      const formData = new FormData();
      formData.set("listingName", listingName);
      formData.set("listingId", listingId);
      formData.set("shotType", shotType);
      for (const file of files) formData.append("photos", file);

      const res = await testUploadAndEnhance(formData);
      if (!res.ok) throw new Error(res.error);
      setListingId(res.listingId);
      setEnhanceId(res.enhanceId);
      setResult({
        id: res.enhanceId,
        status: res.status,
        enhancedImageUrl: res.enhancedImageUrl,
        enhancedImageUrlExpires: res.enhancedImageUrlExpires,
      });
      append(`Listing: ${res.listingId}`);
      append(`Uploaded ${res.uploadIds.length} file(s).`);
      append(`Enhance created: ${res.enhanceId}`);
      append(`Status: ${res.status}${res.enhancedImageUrl ? " · URL ready" : ""}`);
    } catch (err) {
      append(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
    }
  }

  async function refreshEnhance(id = enhanceId) {
    const trimmed = id.trim();
    if (!trimmed) {
      append("Enter an enhance ID first.");
      return;
    }
    append(`Checking enhance: ${trimmed}`);
    const res = await testGetEnhance(trimmed);
    if (!res.ok) {
      append(`getEnhance failed: ${res.error}`);
      return;
    }
    setResult(res);
    append(`Status: ${res.status}${res.enhancedImageUrl ? " · URL ready" : ""}`);
  }

  function buildShareLink() {
    startTransition(() => {
      void (async () => {
        const res = await testFotelloShareLink(listingId);
        if (!res.ok) {
          append(`Share link failed: ${res.error}`);
          return;
        }
        setListingId(res.listingId);
        setDeliveryResult((current) => ({
          listingId: res.listingId,
          shareUrl: res.shareUrl,
          downloadUrl: current?.downloadUrl ?? null,
          totalItems: current?.totalItems ?? null,
          processedItems: current?.processedItems ?? null,
        }));
        append(`Share link ready for listing: ${res.listingId}`);
      })();
    });
  }

  function preparePhotoZip() {
    startTransition(() => {
      void (async () => {
        setDiagnosingZip(true);
        append("Preparing Fotello photo ZIP...");
        setDownloadAttempts([]);
        try {
          const share = await testFotelloShareLink(listingId);
          if (share.ok) {
            setListingId(share.listingId);
            setDeliveryResult({
              listingId: share.listingId,
              shareUrl: share.shareUrl,
              downloadUrl: null,
              totalItems: null,
              processedItems: null,
            });
          }

          const res = await diagnosePrepareDownload({
            listingId,
            photoFormats: ["original"],
            sections: ["photos"],
          });
          setDownloadAttempts(res.attempts);
          if (!res.ok) {
            append(`prepare-download failed: ${res.error}`);
            return;
          }
          setListingId(res.listingId);
          setDeliveryResult({
            listingId: res.listingId,
            shareUrl: share.ok ? share.shareUrl : "",
            downloadUrl: res.downloadUrl,
            totalItems: res.totalItems,
            processedItems: res.processedItems,
          });
          append(
            `ZIP ready: ${res.processedItems}/${res.totalItems} item(s). Link expires soon.`,
          );
        } finally {
          setDiagnosingZip(false);
        }
      })();
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-ink-soft/60 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
          1. Test listing / upload / enhance
        </h2>
        <div className="mt-4 grid gap-3">
          <label className="block">
            <span className="text-xs text-ink-muted">Listing name</span>
            <input
              value={listingName}
              onChange={(event) => setListingName(event.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-ink px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="block">
            <span className="text-xs text-ink-muted">
              Listing ID for upload test
            </span>
            <input
              value={listingId}
              onChange={(event) => setListingId(event.target.value)}
              placeholder="Optional — leave blank to create one"
              className="mt-1 w-full rounded-xl border border-white/10 bg-ink px-3 py-2 text-sm text-white placeholder-ink-muted/60"
            />
          </label>
          <label className="block">
            <span className="text-xs text-ink-muted">Photos</span>
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              className="mt-1 w-full rounded-xl border border-white/10 bg-ink px-3 py-2 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
          </label>
          <label className="block">
            <span className="text-xs text-ink-muted">Shot type</span>
            <select
              value={shotType}
              onChange={(event) => setShotType(event.target.value as "interior" | "exterior")}
              className="mt-1 w-full rounded-xl border border-white/10 bg-ink px-3 py-2 text-sm text-white"
            >
              <option value="interior">interior</option>
              <option value="exterior">exterior</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={createListingOnly}
              disabled={pending || uploading}
              className="rounded-full border border-white/15 px-3 py-2 text-sm text-white hover:border-brand-light hover:bg-brand/10 disabled:opacity-50"
            >
              Create listing only
            </button>
            <button
              type="button"
              onClick={uploadAndEnhance}
              disabled={pending || uploading}
              className="rounded-full bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-50"
            >
              {uploading ? "Working..." : "Upload + create enhance"}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-ink-soft/60 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
          2. Optional: check one enhance
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Use this only when you have a Fotello enhance ID from the upload flow.
          A dashboard/listing ID will usually return 404 here.
        </p>
        <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto]">
          <input
            value={enhanceId}
            onChange={(event) => setEnhanceId(event.target.value)}
            placeholder="Enhance ID, not listing ID"
            className="rounded-xl border border-white/10 bg-ink px-3 py-2 text-sm text-white placeholder-ink-muted/60"
          />
          <button
            type="button"
            onClick={() => refreshEnhance()}
            disabled={pending || uploading || !enhanceId.trim()}
            className="rounded-full bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-50"
          >
            Check enhance
          </button>
        </div>
        {result ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-ink/60 p-3 text-sm">
            <p className="text-white">Status: <span className="font-semibold">{result.status}</span></p>
            <p className="mt-1 break-all text-xs text-ink-muted">ID: {result.id}</p>
            {result.enhancedImageUrl ? (
              <p className="mt-2 break-all text-xs text-ink-muted">
                URL: <a href={result.enhancedImageUrl} target="_blank" rel="noopener" className="text-brand-light underline">{result.enhancedImageUrl}</a>
              </p>
            ) : null}
            {result.enhancedImageUrlExpires ? (
              <p className="mt-1 text-xs text-ink-muted">Expires: {result.enhancedImageUrlExpires}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-white/10 bg-ink-soft/60 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
          3. Test realtor delivery links
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Admin-only sandbox. This does not save to bookings, the realtor portal,
          or delivery emails. Paste the listing ID from Fotello, or the whole
          dashboard URL.
        </p>
        <label className="mt-4 block">
          <span className="text-xs text-ink-muted">
            Listing ID or dashboard URL
          </span>
          <input
            value={listingId}
            onChange={(event) => setListingId(event.target.value)}
            placeholder="https://app.fotello.co/dashboard/listings/WkgmcWEz7UUSqtfwSn6P"
            className="mt-1 w-full rounded-xl border border-white/10 bg-ink px-3 py-2 text-sm text-white placeholder-ink-muted/60"
          />
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={buildShareLink}
            disabled={pending || uploading || !listingId.trim()}
            className="rounded-full border border-white/15 px-3 py-2 text-sm text-white hover:border-brand-light hover:bg-brand/10 disabled:opacity-50"
          >
            Build share link
          </button>
          <button
            type="button"
            onClick={preparePhotoZip}
            disabled={pending || uploading || diagnosingZip || !listingId.trim()}
            className="rounded-full bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-50"
          >
            {diagnosingZip ? "Checking Fotello..." : "Diagnose photo ZIP endpoint"}
          </button>
        </div>
        {diagnosingZip ? (
          <div className="mt-4 rounded-xl border border-amber-200/70 bg-amber-50 p-3 text-sm text-stone-700">
            Checking Fotello's possible ZIP endpoints. This can take up to a
            minute because a couple of the URLs time out instead of answering
            right away.
          </div>
        ) : null}
        {deliveryResult?.shareUrl ? (
          <div className="mt-4 rounded-xl border border-emerald-200/70 bg-emerald-50 p-3 text-sm text-stone-700">
            <p className="font-semibold text-stone-900">
              Share link works and can be used for delivery testing
            </p>
            <a
              href={deliveryResult.shareUrl}
              target="_blank"
              rel="noopener"
              className="mt-2 block break-all text-emerald-800 underline"
            >
              {deliveryResult.shareUrl}
            </a>
          </div>
        ) : null}
        {downloadAttempts.length ? (
          <div className="mt-4 rounded-xl border border-amber-200/60 bg-amber-50 p-3 text-xs text-stone-700">
            <p className="font-semibold text-stone-900">
              Fotello ZIP endpoint attempts
            </p>
            <div className="mt-2 space-y-2">
              {downloadAttempts.map((attempt) => (
                <div
                  key={`${attempt.label}-${attempt.endpoint}`}
                  className="rounded-lg border border-amber-200/70 bg-white/70 p-2"
                >
                  <p className="font-semibold text-stone-900">
                    {attempt.ok ? "Worked" : "Did not work"} · {attempt.label}
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-stone-600">
                    {attempt.endpoint}
                  </p>
                  <p className="mt-1">
                    Status: {attempt.status ?? "request failed"}
                  </p>
                  {attempt.body ? (
                    <p className="mt-1 break-words font-mono text-[11px] text-stone-500">
                      {attempt.body}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {deliveryResult ? (
          <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-ink/60 p-3 text-sm">
            <p className="break-all text-xs text-ink-muted">
              Listing ID: {deliveryResult.listingId}
            </p>
            {deliveryResult.downloadUrl ? (
              <p className="break-all text-xs text-ink-muted">
                ZIP download:{" "}
                <a
                  href={deliveryResult.downloadUrl}
                  target="_blank"
                  rel="noopener"
                  className="text-brand-light underline"
                >
                  {deliveryResult.downloadUrl}
                </a>
              </p>
            ) : null}
            {deliveryResult.totalItems !== null ? (
              <p className="text-xs text-ink-muted">
                Items: {deliveryResult.processedItems}/
                {deliveryResult.totalItems}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-white/10 bg-ink-soft/60 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">Log</h2>
        <div className="mt-3 space-y-1 rounded-xl bg-black/20 p-3 font-mono text-xs text-ink-muted">
          {log.length ? log.map((item) => <p key={item}>{item}</p>) : <p>No test calls yet.</p>}
        </div>
      </section>
    </div>
  );
}
