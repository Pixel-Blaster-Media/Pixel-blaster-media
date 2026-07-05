"use client";

import { useState } from "react";

type ImageResult = {
  bracketId?: string;
  uploadKind?: "image" | "bracket";
  imageId: string;
  imageName: string;
  status: string | null;
  statusReason: string | null;
  scene: string | null;
  enhancedProxyUrl: string;
};

type PreparedUpload = ImageResult & {
  uploadKind: "image" | "bracket";
  bracketId?: string;
  uploadUrl: string;
};

type UploadResult = {
  orderId: string;
  orderName: string;
  images: ImageResult[];
  processStatus: string | null;
  totalImages?: number | null;
  debug?: unknown;
};

type PrepareResponse = {
  ok: true;
  orderId: string;
  orderName: string;
  uploadMode: "single" | "hdr";
  uploads: PreparedUpload[];
};

type ProcessResponse = {
  ok: true;
  orderId: string;
  images: ImageResult[];
  processStatus: string | null;
  totalImages?: number | null;
  debug?: unknown;
};

type OrderResponse = ProcessResponse;

type ImageResponse = {
  ok: true;
  image: ImageResult;
};

type UploadToIGuideResponse = {
  ok: true;
  iguideId: string;
  uploadedCount: number;
  failedCount: number;
  results: Array<{
    imageId: string;
    filename: string;
    assetName?: string;
    jid?: string;
    ok: boolean;
    error?: string;
    warning?: string;
    processComplete?: boolean;
  }>;
};

type ApiError = {
  ok: false;
  error: string;
};

type ApiResponse<T extends { ok: true }> = T | ApiError;

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

export default function AutoenhanceTestClient() {
  const [orderName, setOrderName] = useState("Autoenhance API test");
  const [uploadMode, setUploadMode] = useState<"single" | "hdr">("hdr");
  const [enhanceType, setEnhanceType] = useState("warm");
  const [presetId, setPresetId] = useState("");
  const [skyReplacement, setSkyReplacement] = useState(false);
  const [cloudType, setCloudType] = useState("");
  const [windowPullType, setWindowPullType] = useState("ONLY_WINDOWS");
  const [privacy, setPrivacy] = useState(true);
  const [upscale, setUpscale] = useState(false);
  const [tripodHide, setTripodHide] = useState(false);
  const [fireInFireplaces, setFireInFireplaces] = useState(false);
  const [greenGrass, setGreenGrass] = useState(false);
  const [removePhotographer, setRemovePhotographer] = useState(false);
  const [blackOutTvs, setBlackOutTvs] = useState(false);
  const [bracketsPerImage, setBracketsPerImage] = useState(3);
  const [files, setFiles] = useState<File[]>([]);
  const [imageId, setImageId] = useState("");
  const [iguideId, setIguideId] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  function append(message: string) {
    setLog((items) =>
      [`${new Date().toLocaleTimeString()} · ${message}`, ...items].slice(0, 40),
    );
  }

  async function uploadPhotos() {
    if (!files.length) {
      append("Pick at least one photo first.");
      return;
    }
    setUploading(true);
    try {
      append("Creating Autoenhance order and upload URLs...");
      const prepared = await apiJson<PrepareResponse>(
        "/api/admin/autoenhance-test/prepare",
        {
          method: "POST",
          body: JSON.stringify({
            orderName,
            uploadMode,
            fileNames: files.map((file) => file.name),
            enhanceType,
            presetId,
            skyReplacement,
            cloudType,
            windowPullType,
            privacy,
            upscale,
            tripodHide,
            fireInFireplaces,
            greenGrass,
            removePhotographer,
            blackOutTvs,
          }),
        },
      );
      if (!prepared.ok) {
        append(`Upload setup failed: ${prepared.error}`);
        return;
      }

      setResult({
        orderId: prepared.orderId,
        orderName: prepared.orderName,
        images: prepared.uploads,
        processStatus: "uploading",
      });
      append(`Order ready: ${prepared.orderId}`);

      const uploadedBracketIds: string[] = [];
      const uploadedImages: ImageResult[] = [];
      for (const [index, upload] of prepared.uploads.entries()) {
        const file = files[index];
        if (!file) {
          append(`Skipped ${upload.imageName}: local file not found.`);
          continue;
        }
        append(`Uploading ${file.name} directly to Autoenhance...`);
        const put = await fetch(upload.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: file,
        });
        if (!put.ok) {
          const body = await put.text().catch(() => "");
          append(`Upload failed for ${file.name}: ${put.status} ${body.slice(0, 160)}`);
          continue;
        }
        if (upload.uploadKind === "bracket") {
          if (upload.bracketId) uploadedBracketIds.push(upload.bracketId);
        } else {
          uploadedImages.push({ ...upload, status: "uploaded" });
        }
        append(`Uploaded ${file.name}.`);
      }

      if (prepared.uploadMode === "single") {
        if (!uploadedImages.length) {
          append("No files uploaded successfully, so processing was not started.");
          return;
        }
        setResult({
          orderId: prepared.orderId,
          orderName: prepared.orderName,
          images: uploadedImages,
          processStatus: "uploaded",
          totalImages: uploadedImages.length,
        });
        setImageId(uploadedImages[0]?.imageId ?? "");
        append(
          `Uploaded ${uploadedImages.length} regular photo(s). Autoenhance should process them from the image records.`,
        );
        append("Use Refresh order in a minute to pull updated statuses.");
        return;
      }

      if (!uploadedBracketIds.length) {
        append("No files uploaded successfully, so processing was not started.");
        return;
      }

      append(
        bracketsPerImage === 0
          ? `Starting Autoenhance automatic HDR grouping for ${uploadedBracketIds.length} uploaded bracket file(s)...`
          : `Starting Autoenhance processing as ${Math.ceil(
              uploadedBracketIds.length / bracketsPerImage,
            )} manual HDR group(s)...`,
      );
      const processed = await apiJson<ProcessResponse>(
        "/api/admin/autoenhance-test/process",
        {
          method: "POST",
          body: JSON.stringify({
            orderId: prepared.orderId,
            bracketIds: uploadedBracketIds,
            bracketsPerImage,
            enhanceType,
            presetId,
            skyReplacement,
            cloudType,
            windowPullType,
            privacy,
            upscale,
            tripodHide,
            fireInFireplaces,
            greenGrass,
            removePhotographer,
            blackOutTvs,
          }),
        },
      );
      if (!processed.ok) {
        append(`Process failed: ${processed.error}`);
        return;
      }

      setResult({
        orderId: prepared.orderId,
        orderName: prepared.orderName,
        images: processed.images,
        processStatus: processed.processStatus,
        totalImages: processed.totalImages,
        debug: processed.debug,
      });
      const realImage = processed.images.find(
        (image) => !image.imageId.startsWith("bracket"),
      );
      setImageId(realImage?.imageId ?? "");
      append(
        processed.totalImages
          ? `Autoenhance reports ${processed.totalImages} final image(s).`
          : `Processing started. Use Refresh order to pull final images.`,
      );
      if (processed.processStatus) append(`Order status: ${processed.processStatus}`);
    } catch (err) {
      append(`Autoenhance test failed: ${errorMessage(err)}`);
    } finally {
      setUploading(false);
    }
  }

  async function refreshOrder() {
    if (!result?.orderId) {
      append("Create an order first.");
      return;
    }
    setBusy(true);
    try {
      append(`Refreshing order: ${result.orderId}`);
      const res = await apiJson<OrderResponse>(
        `/api/admin/autoenhance-test/order?orderId=${encodeURIComponent(
          result.orderId,
        )}`,
      );
      if (!res.ok) {
        append(`Order refresh failed: ${res.error}`);
        return;
      }
      setResult((current) => ({
        orderId: res.orderId,
        orderName: current?.orderName ?? "Autoenhance order",
        images: res.images.length ? res.images : current?.images ?? [],
        processStatus: res.processStatus,
        totalImages: res.totalImages,
        debug: res.debug,
      }));
      const realImage = res.images.find(
        (image) => !image.imageId.startsWith("bracket"),
      );
      if (realImage) setImageId(realImage.imageId);
      append(
        res.images.length
          ? `Order has ${res.images.length} image record(s).`
          : "No final image records yet. Try again in a bit.",
      );
    } catch (err) {
      append(`Order refresh failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function pollImage(id = imageId) {
    const trimmed = id.trim();
    if (!trimmed) {
      append("Enter an Autoenhance image ID first.");
      return;
    }
    if (trimmed.startsWith("bracket")) {
      append("That is still a bracket placeholder. Refresh the order first.");
      return;
    }
    setBusy(true);
    try {
      append(`Checking image: ${trimmed}`);
      const res = await apiJson<ImageResponse>(
        `/api/admin/autoenhance-test/image?imageId=${encodeURIComponent(trimmed)}`,
      );
      if (!res.ok) {
        append(`Poll failed: ${res.error}`);
        return;
      }
      setResult((current) => {
        const existing = current ?? {
          orderId: "",
          orderName: "",
          images: [],
          processStatus: null,
        };
        const others = existing.images.filter(
          (image) => image.imageId !== res.image.imageId,
        );
        return { ...existing, images: [res.image, ...others] };
      });
      append(`Status: ${res.image.status ?? "unknown"}`);
    } catch (err) {
      append(`Poll failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function uploadFinishedPhotosToIGuide() {
    const trimmedIGuideId = parseIGuideId(iguideId);
    const imageIds =
      result?.images
        .filter(
          (image) =>
            image.enhancedProxyUrl &&
            !image.imageId.startsWith("bracket"),
        )
        .map((image) => image.imageId) ?? [];

    if (!trimmedIGuideId) {
      append("Paste the iGUIDE Portal ID first.");
      return;
    }
    if (!imageIds.length) {
      append("No processed Autoenhance images are ready to send yet.");
      return;
    }

    setBusy(true);
    try {
      append(
        `Uploading ${imageIds.length} finished photo(s) to iGUIDE ${trimmedIGuideId}...`,
      );
      const res = await apiJson<UploadToIGuideResponse>(
        "/api/admin/autoenhance-test/upload-to-iguide",
        {
          method: "POST",
          body: JSON.stringify({
            iguideId: trimmedIGuideId,
            imageIds,
          }),
        },
      );
      if (!res.ok) {
        append(`iGUIDE upload failed: ${res.error}`);
        return;
      }
      append(
        `iGUIDE upload finished: ${res.uploadedCount} uploaded, ${res.failedCount} failed.`,
      );
      for (const item of res.results.slice(0, 8)) {
        if (!item.ok) {
          append(`Could not add ${item.filename}: ${item.error ?? "unknown error"}`);
          continue;
        }
        append(
          `Added ${item.filename} to iGUIDE${item.jid ? ` (job ${item.jid})` : ""}${
            item.processComplete === true
              ? " and iGUIDE finished processing it"
              : item.processComplete === false
                ? " and iGUIDE is still processing it"
                : ""
          }.`,
        );
        if (item.warning) append(`Note for ${item.filename}: ${item.warning}`);
      }
      if (res.results.length > 8) {
        append(`Plus ${res.results.length - 8} more result(s).`);
      }
    } catch (err) {
      append(`iGUIDE upload failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const pending = uploading || busy;
  const transferableImages =
    result?.images.filter(
      (image) =>
        image.enhancedProxyUrl &&
        !image.imageId.startsWith("bracket"),
    ) ?? [];

  return (
    <div className="space-y-5">
      <section className="realtor-elevated-panel rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-realtor-primary">
          1. Upload a test batch
        </h2>
        <p className="mt-2 text-sm text-realtor-muted">
          This creates a temporary Autoenhance order and uploads selected photos
          straight to Autoenhance&apos;s presigned upload URLs. For your usual
          3-photo bracket shoots, leave HDR grouping on 3 brackets = 1 photo.
          Nothing is saved to bookings.
        </p>

        <div className="mt-5 grid gap-4">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
              Order name
            </span>
            <input
              value={orderName}
              onChange={(event) => setOrderName(event.currentTarget.value)}
              className="admin-input mt-1"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
                Upload type
              </span>
              <select
                value={uploadMode}
                onChange={(event) =>
                  setUploadMode(event.currentTarget.value === "hdr" ? "hdr" : "single")
                }
                className="admin-input mt-1"
              >
                <option value="hdr">HDR bracket photos</option>
                <option value="single">Single finished photos</option>
              </select>
              <span className="mt-1 block text-[11px] text-realtor-muted">
                Use HDR for your normal 3-photo bracket sets, even if they are JPGs.
              </span>
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
                Enhancement style
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

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
                HDR grouping method
              </span>
              <select
                value={bracketsPerImage}
                onChange={(event) =>
                  setBracketsPerImage(Number(event.currentTarget.value))
                }
                disabled={uploadMode !== "hdr"}
            className="admin-input mt-1"
          >
                <option value={3}>3 brackets = 1 photo</option>
                <option value={0}>Auto-detect from photo timing</option>
                <option value={1}>1 file = 1 photo</option>
                <option value={5}>5 brackets = 1 photo</option>
                <option value={7}>7 brackets = 1 photo</option>
              </select>
              <span className="mt-1 block text-[11px] text-realtor-muted">
                {uploadMode === "hdr"
                  ? "Use 3 for your normal bracket sets. Auto is a fallback when the sets are mixed."
                  : "Only used when upload type is HDR bracket groups."}
              </span>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
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
                className="admin-input mt-1 file:mr-3 file:rounded-full file:border-0 file:bg-realtor-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
              />
              <span className="mt-1 block text-[11px] text-realtor-muted">
                If your camera RAW file is still greyed out, drag it into this
                file picker from Finder.
              </span>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
                Window pull
              </span>
              <select
                value={windowPullType}
                onChange={(event) => setWindowPullType(event.currentTarget.value)}
                className="admin-input mt-1"
              >
                <option value="">Auto/default</option>
                <option value="NONE">None</option>
                <option value="ONLY_WINDOWS">Windows only</option>
                <option value="WINDOWS_WITH_SKIES">Windows + skies</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
                Sky cloud type
              </span>
              <select
                value={cloudType}
                onChange={(event) => setCloudType(event.currentTarget.value)}
                className="admin-input mt-1"
              >
                <option value="">Auto/default</option>
                <option value="CLEAR">Clear</option>
                <option value="LOW_CLOUD">Low cloud</option>
                <option value="HIGH_CLOUD">High cloud</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
                Preset ID
              </span>
              <input
                value={presetId}
                onChange={(event) => setPresetId(event.currentTarget.value)}
                placeholder="Optional Autoenhance preset"
                className="admin-input mt-1"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-3 rounded-2xl border border-realtor-primary/10 bg-realtor-primary/5 p-3">
            <Toggle
              checked={privacy}
              label="Blur faces / plates"
              onChange={setPrivacy}
            />
            <Toggle
              checked={skyReplacement}
              label="Sky replacement"
              onChange={setSkyReplacement}
            />
            <Toggle checked={upscale} label="Upscale" onChange={setUpscale} />
            <Toggle
              checked={tripodHide}
              label="Hide 360 tripod"
              onChange={setTripodHide}
            />
            <Toggle
              checked={fireInFireplaces}
              label="Light fireplaces"
              onChange={setFireInFireplaces}
            />
            <Toggle
              checked={greenGrass}
              label="Green grass"
              onChange={setGreenGrass}
            />
            <Toggle
              checked={removePhotographer}
              label="Remove photographer/reflections"
              onChange={setRemovePhotographer}
            />
            <Toggle
              checked={blackOutTvs}
              label="Black out TVs"
              onChange={setBlackOutTvs}
            />
          </div>

          <button
            type="button"
            onClick={uploadPhotos}
            disabled={pending || uploading || !files.length}
            className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-realtor-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploading ? "Uploading..." : "Create order + upload photos"}
          </button>
        </div>
      </section>

      <section className="realtor-elevated-panel rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-realtor-primary">
          2. Check an image
        </h2>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            value={imageId}
            onChange={(event) => setImageId(event.currentTarget.value)}
            placeholder="Autoenhance image_id"
            className="admin-input"
          />
          <button
            type="button"
            onClick={() => pollImage()}
            disabled={pending || !imageId.trim()}
            className="rounded-full border border-realtor-primary/20 bg-white px-4 py-2 text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5 disabled:opacity-60"
          >
            Refresh status
          </button>
        </div>
      </section>

      {result ? (
        <section className="realtor-elevated-panel rounded-2xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
                Test result
              </p>
              <h2 className="mt-1 text-lg font-semibold text-realtor-text">
                {result.orderName || "Autoenhance image"}
              </h2>
            </div>
            {result.orderId ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-realtor-primary/15 bg-white px-3 py-1 text-xs text-realtor-muted">
                  Order {result.orderId}
                </span>
                <button
                  type="button"
                  onClick={refreshOrder}
                  disabled={pending}
                  className="rounded-full border border-realtor-primary/20 bg-white px-3 py-1 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5 disabled:opacity-60"
                >
                  Refresh order
                </button>
              </div>
            ) : null}
          </div>
          <div className="mt-4 space-y-3">
            {result.images.map((image) => (
              <div
                key={image.imageId}
                className="rounded-2xl border border-realtor-primary/10 bg-white/70 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-realtor-text">
                      {image.imageName}
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-realtor-muted">
                      {image.imageId}
                    </p>
                    {image.bracketId ? (
                      <p className="mt-1 break-all font-mono text-[11px] text-realtor-muted">
                        Bracket: {image.bracketId}
                      </p>
                    ) : null}
                    <p className="mt-2 text-sm text-realtor-muted">
                      Status:{" "}
                      <span className="font-semibold text-realtor-text">
                        {image.status ?? "unknown"}
                      </span>
                      {image.scene ? ` · Scene: ${image.scene}` : ""}
                    </p>
                    {image.statusReason ? (
                      <p className="mt-1 text-xs text-amber-700">
                        {image.statusReason}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setImageId(image.imageId);
                        pollImage(image.imageId);
                      }}
                      disabled={pending}
                      className="rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5 disabled:opacity-60"
                    >
                      Refresh
                    </button>
                    {image.enhancedProxyUrl &&
                    !image.imageId.startsWith("bracket") ? (
                      <a
                        href={image.enhancedProxyUrl}
                        target="_blank"
                        rel="noopener"
                        className="rounded-full bg-realtor-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-realtor-primary/90"
                      >
                        Preview enhanced
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="realtor-elevated-panel rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-realtor-primary">
          3. Send finished photos to iGUIDE
        </h2>
        <p className="mt-2 text-sm text-realtor-muted">
          Paste the linked iGUIDE Portal ID. This pulls the finished
          Autoenhance JPEGs, uploads them to iGUIDE, and appends them to the
          default gallery view. It only unlocks after Autoenhance returns final
          enhanced photo IDs, not just uploaded bracket files.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            value={iguideId}
            onChange={(event) => setIguideId(event.currentTarget.value)}
            placeholder="iGUIDE Portal ID or manage.youriguide.com edit URL"
            className="admin-input"
          />
          <button
            type="button"
            onClick={uploadFinishedPhotosToIGuide}
            disabled={pending || !iguideId.trim() || !transferableImages.length}
            className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-realtor-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Upload to iGUIDE gallery
          </button>
        </div>
        <p className="mt-2 text-xs text-realtor-muted">
          Finished Autoenhance photos detected: {transferableImages.length}. If
          this says 0, Autoenhance still has only the uploaded bracket/original
          files. Refresh the order after processing finishes.
          {iguideId.trim() && parseIGuideId(iguideId) ? (
            <> Parsed iGUIDE ID: {parseIGuideId(iguideId)}.</>
          ) : null}
        </p>
      </section>

      <section className="realtor-elevated-panel rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-realtor-primary">
          Log
        </h2>
        <div className="mt-3 space-y-1 rounded-2xl border border-realtor-primary/10 bg-white/65 p-3 font-mono text-xs text-realtor-muted">
          {log.length ? (
            log.map((item) => <p key={item}>{item}</p>)
          ) : (
            <p>No test calls yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

async function apiJson<T extends { ok: true }>(
  url: string,
  init?: RequestInit,
): Promise<ApiResponse<T>> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) {
    return { ok: false, error: `Could not read response from ${url}.` };
  }
  if (!res.ok && body.ok !== false) {
    return { ok: false, error: `Request failed with status ${res.status}.` };
  }
  return body;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseIGuideId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? "";
  } catch {
    return trimmed;
  }
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
