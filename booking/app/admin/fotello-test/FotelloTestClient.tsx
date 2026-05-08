"use client";

import { useState, useTransition } from "react";

import {
  testCreateEnhance,
  testCreateListing,
  testCreateUpload,
  testGetEnhance,
} from "./actions";

type EnhanceResult = {
  id: string;
  status: string;
  enhancedImageUrl: string | null;
  enhancedImageUrlExpires: string | null;
};

export default function FotelloTestClient() {
  const [listingName, setListingName] = useState("Fotello API test");
  const [listingId, setListingId] = useState("");
  const [enhanceId, setEnhanceId] = useState("");
  const [shotType, setShotType] = useState<"interior" | "exterior">("interior");
  const [files, setFiles] = useState<File[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<EnhanceResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);

  function append(message: string) {
    setLog((items) => [`${new Date().toLocaleTimeString()} · ${message}`, ...items].slice(0, 30));
  }

  function createListingOnly() {
    startTransition(async () => {
      append("Creating Fotello listing...");
      const res = await testCreateListing(listingName);
      if (!res.ok) {
        append(`Listing failed: ${res.error}`);
        return;
      }
      setListingId(res.id);
      append(`Listing created: ${res.id}`);
    });
  }

  async function uploadAndEnhance() {
    if (!files.length) {
      append("Pick at least one photo first.");
      return;
    }
    setUploading(true);
    try {
      let currentListingId = listingId.trim();
      if (!currentListingId) {
        append("No listing ID set — creating test listing...");
        const listing = await testCreateListing(listingName);
        if (!listing.ok) throw new Error(listing.error);
        currentListingId = listing.id;
        setListingId(listing.id);
        append(`Listing created: ${listing.id}`);
      }

      const uploadIds: string[] = [];
      for (const [index, file] of files.entries()) {
        append(`Creating upload ${index + 1}/${files.length}: ${file.name}`);
        const upload = await testCreateUpload(file.name);
        if (!upload.ok) throw new Error(upload.error);
        append(`Uploading to presigned URL: ${upload.id}`);
        const put = await fetch(upload.url, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: file,
        });
        if (!put.ok) throw new Error(`Presigned upload failed for ${file.name}: ${put.status}`);
        uploadIds.push(upload.id);
      }

      append(`Starting enhance with ${uploadIds.length} upload ID(s)...`);
      const enhance = await testCreateEnhance({
        listingId: currentListingId,
        uploadIds,
        shotType,
      });
      if (!enhance.ok) throw new Error(enhance.error);
      setEnhanceId(enhance.id);
      append(`Enhance created: ${enhance.id}`);
      await refreshEnhance(enhance.id);
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
            <span className="text-xs text-ink-muted">Listing ID</span>
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
          2. Test getEnhance
        </h2>
        <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto]">
          <input
            value={enhanceId}
            onChange={(event) => setEnhanceId(event.target.value)}
            placeholder="Enhance ID"
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
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">Log</h2>
        <div className="mt-3 space-y-1 rounded-xl bg-black/20 p-3 font-mono text-xs text-ink-muted">
          {log.length ? log.map((item) => <p key={item}>{item}</p>) : <p>No test calls yet.</p>}
        </div>
      </section>
    </div>
  );
}
