"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import type {
  CatalogItemExampleAdminRow,
  ReusableCatalogVideo,
} from "@/lib/booking/catalog-examples";
import {
  CATALOG_SAMPLE_GROUP_OPTIONS,
  resolveCatalogSampleGroup,
} from "@/lib/booking/catalog-sample-groups";
import {
  attachCatalogExample,
  attachSharedCatalogVideo,
  deleteCatalogExample,
  removeSharedCatalogVideoPlacement,
} from "./example-actions";

const MAX_BASIC_VIDEO_BYTES = 200 * 1024 * 1024;

export default function CatalogExamplesEditor({
  catalogItemId,
  examples,
  reusableVideos,
  streamConfigured,
}: {
  catalogItemId: string;
  examples: CatalogItemExampleAdminRow[];
  reusableVideos: ReusableCatalogVideo[];
  streamConfigured: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"closed" | "url" | "upload" | "reuse">("closed");
  const [sourceExampleId, setSourceExampleId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"video" | "interactive" | "link">("interactive");
  const [sampleGroup, setSampleGroup] = useState("iguide");
  const [customSampleGroupLabel, setCustomSampleGroupLabel] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const attachedSources = new Set(examples.map((example) => example.source_example_id));
  const availableReusableVideos = reusableVideos.filter(
    (video) => video.catalog_item_id !== catalogItemId && !attachedSources.has(video.id),
  );

  const reset = () => {
    setMode("closed");
    setSourceExampleId("");
    setTitle("");
    setDescription("");
    setUrl("");
    setSampleGroup("iguide");
    setCustomSampleGroupLabel("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const attachUrl = () => {
    const formData = new FormData();
    formData.set("catalog_item_id", catalogItemId);
    formData.set("title", title);
    formData.set("description", description);
    formData.set("kind", kind);
    formData.set("sample_group", sampleGroup);
    formData.set("custom_sample_group_label", customSampleGroupLabel);
    formData.set("external_url", url);
    setError(null);
    startTransition(async () => {
      const result = await attachCatalogExample(formData);
      if (!result.ok) return setError(result.error ?? "Could not attach example.");
      reset();
      router.refresh();
    });
  };

  const attachReusable = () => {
    if (!sourceExampleId) return setError("Choose a reusable video.");
    const formData = new FormData();
    formData.set("catalog_item_id", catalogItemId);
    formData.set("source_example_id", sourceExampleId);
    formData.set("title", title);
    formData.set("description", description);
    setError(null);
    startTransition(async () => {
      const result = await attachSharedCatalogVideo(formData);
      if (!result.ok) return setError(result.error ?? "Could not reuse video.");
      reset();
      router.refresh();
    });
  };

  const uploadVideo = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose a video file.");
    if (!title.trim()) return setError("Add a title for the example.");
    if (!file.type.startsWith("video/")) return setError("Choose a video file.");
    if (file.size < 1 || file.size > MAX_BASIC_VIDEO_BYTES) {
      return setError("Video uploads must be 200 MB or smaller.");
    }

    setError(null);
    setProgress("Preparing secure upload…");
    try {
      const prepared = await fetch("/api/admin/catalog-examples/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalogItemId,
          title,
          description,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const preparedBody = await safeJson(prepared);
      if (!prepared.ok || typeof preparedBody.uploadUrl !== "string" || typeof preparedBody.exampleId !== "string") {
        throw new Error(message(preparedBody, "Could not prepare upload."));
      }

      setProgress("Uploading video to Cloudflare…");
      const uploadBody = new FormData();
      uploadBody.set("file", file);
      const uploaded = await fetch(preparedBody.uploadUrl, {
        method: "POST",
        body: uploadBody,
        referrerPolicy: "no-referrer",
      });
      if (!uploaded.ok) throw new Error("Cloudflare could not receive the video.");

      setProgress("Processing video…");
      await waitUntilReady(preparedBody.exampleId);
      setProgress("Video example added.");
      reset();
      router.refresh();
    } catch (caught) {
      setProgress(null);
      setError(caught instanceof Error ? caught.message : "Video upload failed.");
    }
  };

  const checkProcessing = async (exampleId: string) => {
    setError(null);
    setProgress("Checking video processing…");
    try {
      await waitUntilReady(exampleId);
      setProgress(null);
      router.refresh();
    } catch (caught) {
      setProgress(null);
      setError(caught instanceof Error ? caught.message : "Could not check video processing.");
    }
  };

  return (
    <section
      aria-busy={Boolean(progress)}
      className="min-w-0 rounded-2xl border border-realtor-primary/15 bg-white/65 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-realtor-primary">
            Client examples
          </p>
          <p className="mt-1 text-[11px] text-realtor-muted">
            Show examples without sending clients away from their booking.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={Boolean(progress)}
            onClick={() => setMode(mode === "url" ? "closed" : "url")}
            className="tap-target rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs font-semibold text-realtor-text hover:border-realtor-primary/40"
          >
            Attach URL
          </button>
          <button
            type="button"
            disabled={availableReusableVideos.length === 0 || Boolean(progress)}
            onClick={() => setMode(mode === "reuse" ? "closed" : "reuse")}
            title={availableReusableVideos.length > 0 ? undefined : "No other uploaded videos are available"}
            className="tap-target rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs font-semibold text-realtor-text hover:border-realtor-primary/40 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Use existing video
          </button>
          <button
            type="button"
            disabled={!streamConfigured || Boolean(progress)}
            aria-describedby={!streamConfigured ? `stream-disabled-${catalogItemId}` : undefined}
            onClick={() => setMode(mode === "upload" ? "closed" : "upload")}
            title={streamConfigured ? undefined : "Cloudflare Stream must be configured first"}
            className="tap-target rounded-full bg-realtor-primary px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            Upload video
          </button>
        </div>
      </div>

      {streamConfigured ? (
        <p className="mt-2 text-[11px] text-realtor-muted">
          Stream configuration was detected. Operational access is verified by Cloudflare when each upload is prepared.
        </p>
      ) : (
        <p id={`stream-disabled-${catalogItemId}`} className="mt-2 text-[11px] text-amber-800">
          Video upload is unavailable until this deployment’s Cloudflare Stream connection is configured and verified. Attaching HTTPS links still works.
        </p>
      )}

      {examples.length > 0 ? (
        <ul className="mt-3 divide-y divide-realtor-primary/10 rounded-xl border border-realtor-primary/10 bg-realtor-surface/70">
          {examples.map((example) => (
            <li key={example.id} className="flex flex-col items-start gap-2 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-realtor-text">{example.title}</p>
                <p className="text-[10px] uppercase tracking-wider text-realtor-muted">
                  {example.is_shared
                    ? "Shared placement · Uploaded video"
                    : example.source_type === "cloudflare_stream" ? "Uploaded video" : example.kind}
                  {example.status !== "ready" ? ` · ${example.status}` : ""}
                  {!example.active ? " · hidden" : ""}
                  {` · ${resolveCatalogSampleGroup(example).label} pill`}
                </p>
              </div>
              <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
                {!example.is_shared
                  && example.source_type === "cloudflare_stream"
                  && (
                    example.status === "uploading"
                    || (example.status === "ready" && (example.video_width === null || example.video_height === null))
                  ) ? (
                  <button
                    type="button"
                    disabled={Boolean(progress)}
                    onClick={() => void checkProcessing(example.id)}
                    className="tap-target text-xs font-semibold text-realtor-primary disabled:opacity-50"
                  >
                    {example.status === "ready" ? "Recover video details" : "Check processing"}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    const prompt = example.is_shared
                      ? `Unlink “${example.title}” from this service? The uploaded video will remain available elsewhere.`
                      : `Remove “${example.title}”? Uploaded videos are deleted everywhere only when they have no shared placements.`;
                    if (!confirm(prompt)) return;
                    setError(null);
                    startTransition(async () => {
                      const result = example.is_shared
                        ? await removeSharedCatalogVideoPlacement(example.placement_id ?? "")
                        : await deleteCatalogExample(example.id);
                      if (!result.ok) setError(result.error ?? "Could not remove example.");
                      router.refresh();
                    });
                  }}
                  className="tap-target text-xs font-semibold text-red-700 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {mode !== "closed" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (mode === "url") attachUrl();
            else if (mode === "reuse") attachReusable();
            else void uploadVideo();
          }}
          className="mt-3 grid min-w-0 gap-3 border-t border-realtor-primary/10 pt-3"
        >
          {mode === "reuse" ? (
            <Field label="Reusable video">
              <select
                value={sourceExampleId}
                onChange={(event) => {
                  const selectedId = event.target.value;
                  const selected = availableReusableVideos.find((video) => video.id === selectedId);
                  setSourceExampleId(selectedId);
                  setTitle(selected?.title ?? "");
                  setDescription(selected?.description ?? "");
                }}
                required
                className="w-full min-w-0 rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text"
              >
                <option value="">Choose an uploaded video…</option>
                {availableReusableVideos.map((video) => (
                  <option key={video.id} value={video.id}>{video.title}</option>
                ))}
              </select>
            </Field>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Example title">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                placeholder={mode === "upload" ? "Full property video" : "iGUIDE example"}
                className="w-full min-w-0 rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text"
              />
            </Field>
            {mode === "url" ? (
              <Field label="Example type">
                <select
                  value={kind}
                  onChange={(event) => {
                    const nextKind = event.target.value as typeof kind;
                    setKind(nextKind);
                    setSampleGroup(nextKind === "video" ? "video" : nextKind === "interactive" ? "iguide" : "custom");
                  }}
                  className="w-full min-w-0 rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text"
                >
                  <option value="interactive">Interactive example</option>
                  <option value="video">Video link</option>
                  <option value="link">Web page</option>
                </select>
              </Field>
            ) : null}
          </div>
          {mode === "url" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Show sample under">
                <select
                  value={sampleGroup}
                  onChange={(event) => setSampleGroup(event.target.value)}
                  className="w-full min-w-0 rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text"
                >
                  {CATALOG_SAMPLE_GROUP_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label} pill</option>
                  ))}
                  <option value="custom">Custom pill</option>
                </select>
              </Field>
              {sampleGroup === "custom" ? (
                <Field label="Custom pill label">
                  <input
                    value={customSampleGroupLabel}
                    onChange={(event) => setCustomSampleGroupLabel(event.target.value)}
                    maxLength={24}
                    required
                    placeholder="Site Plan"
                    className="w-full min-w-0 rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text"
                  />
                </Field>
              ) : null}
            </div>
          ) : null}
          <Field label="Short explanation (optional)">
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
              placeholder="What clients should notice about this option"
              className="w-full min-w-0 rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text"
            />
          </Field>

          {mode === "url" ? (
            <>
              <Field label="HTTPS URL">
                <input
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://…"
                  className="w-full min-w-0 rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text"
                />
              </Field>
              <p className="text-[11px] text-realtor-muted">
                YouTube, Vimeo, and iGUIDE open in the player. Other safe HTTPS examples open externally without losing booking progress.
              </p>
              <button
                type="submit"
                disabled={pending}
                className="tap-target justify-self-start rounded-full bg-realtor-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {pending ? "Attaching…" : "Attach example"}
              </button>
            </>
          ) : mode === "reuse" ? (
            <>
              <p className="text-[11px] text-realtor-muted">
                This creates a shared placement. The same Cloudflare video is not uploaded or stored again.
              </p>
              <button
                type="submit"
                disabled={pending || !sourceExampleId}
                className="tap-target justify-self-start rounded-full bg-realtor-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {pending ? "Adding…" : "Use video here"}
              </button>
            </>
          ) : (
            <>
              <input ref={fileRef} type="file" accept="video/*" className="block w-full min-w-0 max-w-full text-xs text-realtor-muted file:mr-3 file:max-w-full file:rounded-full file:border-0 file:bg-realtor-primary/10 file:px-3 file:py-2 file:font-semibold file:text-realtor-primary" />
              <p className="text-[11px] text-realtor-muted">
                Cloudflare Stream optimizes playback automatically. Maximum 10 minutes and 200 MB per example.
              </p>
              <button
                type="submit"
                disabled={Boolean(progress)}
                className="tap-target justify-self-start rounded-full bg-realtor-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {progress ?? "Upload video"}
              </button>
            </>
          )}
        </form>
      ) : null}

      {progress ? (
        <p role="status" aria-live="polite" className="mt-3 text-xs text-realtor-primary">
          {progress}
        </p>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-xs text-red-700">{error}</p> : null}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-realtor-muted">{label}</span>
      {children}
    </label>
  );
}

async function waitUntilReady(exampleId: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`/api/admin/catalog-examples/${encodeURIComponent(exampleId)}/complete`, {
      method: "POST",
    });
    const body = await safeJson(response);
    if (response.ok && body.ok === true) return;
    if (response.status !== 202) throw new Error(message(body, "Could not finish video processing."));
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error("The video is still processing. It remains hidden; use Check processing again shortly.");
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function message(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === "string" ? body.error : fallback;
}
