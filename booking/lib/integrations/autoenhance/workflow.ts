import "server-only";
import { randomUUID } from "node:crypto";
import { withMediaDeadline, mediaSignal } from "@/lib/integrations/iguide/bounded-media";

import type { AdminContext } from "@/lib/auth/require-admin";
import {
  AutoenhanceError,
  createBracket,
  createImage,
  createOrder,
  deleteOrder,
  fetchEnhancedImage,
  getImage,
  getOrder,
  getOrderBrackets,
  processOrder,
  type AutoenhanceCloudType,
  type AutoenhanceEnhanceType,
  type AutoenhanceRestageOptions,
  type AutoenhanceWindowPullType,
} from "@/lib/integrations/autoenhance/client";
import { uploadAssetToIGuide, getUploadProcessingStatus } from "@/lib/integrations/iguide/portal-client";
import {
  isPhotoEditingProviderEnabled,
  requirePhotoEditingProviderEnabled,
} from "@/lib/integrations/provider-enablement";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

type AutoenhanceUploadMode = "hdr" | "single";

type AutoenhanceWorkflowSettings = {
  uploadMode: AutoenhanceUploadMode;
  enhanceType: AutoenhanceEnhanceType;
  presetId?: string;
  skyReplacement: boolean;
  cloudType: AutoenhanceCloudType | null;
  windowPullType: AutoenhanceWindowPullType | null;
  privacy: boolean;
  upscale: boolean;
  tripodHide: boolean;
  fireInFireplaces: boolean;
  greenGrass: boolean;
  removePhotographer: boolean;
  blackOutTvs: boolean;
  bracketsPerImage: number;
};

export type AutoenhanceWorkflowSettingsInput = Partial<
  Record<keyof AutoenhanceWorkflowSettings, unknown>
>;

type AutoenhanceImageResult = {
  bracketId?: string;
  uploadKind?: "image" | "bracket";
  imageId: string;
  imageName: string;
  status: string | null;
  statusReason: string | null;
  scene: string | null;
  enhanced: boolean;
  enhancedProxyUrl: string;
};

export type AutoenhancePreparedUpload = AutoenhanceImageResult & {
  uploadKind: "image" | "bracket";
  bracketId?: string;
  uploadUrl: string;
};

export type AutoenhanceBatchSummary = {
  id: string;
  bookingId: string;
  orderId: string;
  orderName: string;
  uploadMode: AutoenhanceUploadMode;
  status: string;
  processStatus: string | null;
  bracketsPerImage: number;
  finishedImageIds: string[];
  iguidePortalId: string | null;
  iguideUploadedImageIds: string[];
  iguideFailedImageIds: string[];
  uploadedCount: number;
  failedCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  images: AutoenhanceImageResult[];
  uploads: AutoenhanceIGuideUploadSummary[];
};

type AutoenhanceIGuideUploadSummary = {
  imageId: string;
  filename: string;
  status: "pending" | "uploaded" | "failed";
  warning: string | null;
  error: string | null;
  processComplete: boolean | null;
  updatedAt: string;
};

type BookingAutoenhanceRow = {
  id: string;
  organization_id: string;
  property_id: string;
  iguide_portal_id: string | null;
  properties: {
    street_address: string;
    city: string | null;
  } | null;
};

type AutoenhanceBatchRow = {
  id: string;
  organization_id: string;
  booking_id: string;
  property_id: string;
  order_id: string;
  order_name: string;
  upload_mode: AutoenhanceUploadMode;
  status: string;
  process_status: string | null;
  brackets_per_image: number;
  settings: Json;
  bracket_ids: string[];
  uploaded_image_ids: string[];
  finished_image_ids: string[];
  iguide_portal_id: string | null;
  iguide_uploaded_image_ids: string[];
  iguide_failed_image_ids: string[];
  last_iguide_push_at: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type AutoenhanceUploadRow = {
  id: string;
  autoenhance_image_id: string;
  filename: string;
  status: "pending" | "uploaded" | "failed";
  warning: string | null;
  error: string | null;
  process_complete: boolean | null;
  updated_at: string;
};

type PendingAutoenhanceBatchRow = {
  id: string;
  organization_id: string;
};

export async function createBookingAutoenhanceBatch({
  admin,
  bookingId,
  fileNames,
  settings,
}: {
  admin: AdminContext;
  bookingId: string;
  fileNames: string[];
  settings: AutoenhanceWorkflowSettingsInput;
}): Promise<
  | {
      ok: true;
      batch: AutoenhanceBatchSummary;
      uploads: AutoenhancePreparedUpload[];
    }
  | { ok: false; error: string }
> {
  await requirePhotoEditingProviderEnabled("autoenhance", admin.organizationId);
  if (fileNames.length > 160) {
    return { ok: false, error: "Upload 160 files or fewer in one batch." };
  }
  const cleanedFileNames = fileNames
    .map((name) => String(name).trim())
    .filter(Boolean);
  if (!cleanedFileNames.length) return { ok: false, error: "Pick at least one image." };
  if (cleanedFileNames.some((name) => name.length > 255)) {
    return { ok: false, error: "One of the photo filenames is too long." };
  }

  const service = getServiceSupabase();
  const booking = await loadBooking(service, bookingId, admin.organizationId);
  if (!booking) return { ok: false, error: "Booking not found." };

  const normalized = normalizeSettings(settings);
  const orderName = buildOrderName(booking);
  const order = await createOrder(orderName, admin.organizationId);
  if (!order.order_id) {
    return { ok: false, error: "Autoenhance did not return an order ID." };
  }

  let uploads: AutoenhancePreparedUpload[];
  try {
    uploads = await mapWithConcurrency(
      cleanedFileNames,
      6,
      async (fileName) =>
        prepareAutoenhanceUpload({
          fileName,
          orderId: order.order_id,
          organizationId: admin.organizationId,
          settings: normalized,
        }),
    );
  } catch (err) {
    await deleteOrder(order.order_id, admin.organizationId).catch(() => undefined);
    return {
      ok: false,
      error: `Could not prepare the Autoenhance uploads. ${errorMessage(err)}`,
    };
  }

  const { data: batch, error } = await service
    .from("autoenhance_batches")
    .insert({
      organization_id: admin.organizationId,
      booking_id: booking.id,
      property_id: booking.property_id,
      order_id: order.order_id,
      order_name: orderName,
      upload_mode: normalized.uploadMode,
      status: "uploading",
      process_status: order.status ?? null,
      brackets_per_image: normalized.bracketsPerImage,
      settings: settingsToJson(normalized),
      bracket_ids: uploads
        .map((upload) => upload.bracketId)
        .filter((id): id is string => Boolean(id)),
      uploaded_image_ids:
        normalized.uploadMode === "single"
          ? uploads.map((upload) => upload.imageId)
          : [],
      iguide_portal_id: booking.iguide_portal_id,
      created_by: admin.userId,
    })
    .select(
      "id, organization_id, booking_id, property_id, order_id, order_name, upload_mode, status, process_status, brackets_per_image, settings, bracket_ids, uploaded_image_ids, finished_image_ids, iguide_portal_id, iguide_uploaded_image_ids, iguide_failed_image_ids, last_iguide_push_at, last_error, created_by, created_at, updated_at",
    )
    .single<AutoenhanceBatchRow>();

  if (error || !batch) {
    await deleteOrder(order.order_id, admin.organizationId).catch(() => undefined);
    return { ok: false, error: error?.message ?? "Could not save Autoenhance batch." };
  }

  return {
    ok: true,
    batch: summarizeBatch(batch, [], uploads),
    uploads,
  };
}

async function prepareAutoenhanceUpload({
  fileName,
  orderId,
  organizationId,
  settings,
}: {
  fileName: string;
  orderId: string;
  organizationId: string;
  settings: AutoenhanceWorkflowSettings;
}): Promise<AutoenhancePreparedUpload> {
  if (settings.uploadMode === "single") {
    const image = await createImage(
      {
        orderId,
        imageName: fileName,
        enhanceType: settings.enhanceType,
        presetId: settings.presetId,
        skyReplacement: settings.skyReplacement,
        cloudType: settings.cloudType,
        windowPullType: settings.windowPullType,
        privacy: settings.privacy,
        upscale: settings.upscale,
        tripodHide: settings.tripodHide,
        restage: restageOptions(settings),
      },
      organizationId,
    );
    if (!image.image_id || !image.upload_url) {
      throw new Error(
        `Autoenhance did not return an upload URL for ${fileName}.`,
      );
    }
    return {
      ...formatImageResult(image, fileName),
      uploadKind: "image",
      uploadUrl: image.upload_url,
    };
  }

  const bracket = await createBracket(
    { orderId, name: fileName },
    organizationId,
  );
  if (!bracket.bracket_id || !bracket.upload_url) {
    throw new Error(
      `Autoenhance did not return a bracket upload URL for ${fileName}.`,
    );
  }
  return {
    ...formatImageResult(
      {
        image_id: bracket.image_id ?? `bracket:${bracket.bracket_id}`,
        image_name: bracket.name ?? fileName,
        status: bracket.is_uploaded ? "uploaded" : "registered",
      },
      fileName,
    ),
    uploadKind: "bracket",
    bracketId: bracket.bracket_id,
    uploadUrl: bracket.upload_url,
  };
}

export async function startBookingAutoenhanceProcessing({
  admin,
  bookingId,
  batchId,
  uploadedBracketIds,
  uploadedImageIds,
}: {
  admin: AdminContext;
  bookingId?: string;
  batchId: string;
  uploadedBracketIds: string[];
  uploadedImageIds: string[];
}): Promise<{ ok: true; batch: AutoenhanceBatchSummary } | { ok: false; error: string }> {
  await requirePhotoEditingProviderEnabled("autoenhance", admin.organizationId);
  const service = getServiceSupabase();
  const batch = await loadBatch(
    service,
    batchId,
    admin.organizationId,
    bookingId,
  );
  if (!batch) return { ok: false, error: "Autoenhance batch not found." };

  const settings = normalizeSettings(batch.settings);
  const cleanBracketIds = [...new Set(uploadedBracketIds.map(String).filter(Boolean))];
  const cleanImageIds = [...new Set(uploadedImageIds.map(String).filter(Boolean))];

  if (
    cleanBracketIds.some((id) => !batch.bracket_ids.includes(id)) ||
    cleanImageIds.some((id) => !batch.uploaded_image_ids.includes(id))
  ) {
    return { ok: false, error: "The uploaded files do not match this Autoenhance batch." };
  }

  let processStatus = batch.process_status;
  let lastError: string | null = null;
  if (batch.upload_mode === "hdr") {
    if (!cleanBracketIds.length) {
      return { ok: false, error: "No uploaded bracket files were provided." };
    }
    try {
      const processed = await processOrder(batch.order_id, admin.organizationId, {
        bracketsPerImage: settings.bracketsPerImage,
        enhanceType: settings.enhanceType,
        presetId: settings.presetId,
        skyReplacement: settings.skyReplacement,
        cloudType: settings.cloudType,
        windowPullType: settings.windowPullType,
        privacy: settings.privacy,
        upscale: settings.upscale,
        tripodHide: settings.tripodHide,
        restage: restageOptions(settings),
      });
      processStatus = orderProcessStatus(processed, processStatus);
    } catch (err) {
      lastError = errorMessage(err);
    }
  }

  const { data: updated, error } = await service
    .from("autoenhance_batches")
    .update({
      status: lastError ? "attention" : "processing",
      process_status: processStatus,
      bracket_ids: cleanBracketIds.length ? cleanBracketIds : batch.bracket_ids,
      uploaded_image_ids: cleanImageIds.length ? cleanImageIds : batch.uploaded_image_ids,
      last_error: lastError,
    })
    .eq("id", batch.id)
    .eq("organization_id", admin.organizationId)
    .select(
      "id, organization_id, booking_id, property_id, order_id, order_name, upload_mode, status, process_status, brackets_per_image, settings, bracket_ids, uploaded_image_ids, finished_image_ids, iguide_portal_id, iguide_uploaded_image_ids, iguide_failed_image_ids, last_iguide_push_at, last_error, created_by, created_at, updated_at",
    )
    .single<AutoenhanceBatchRow>();

  if (error || !updated) {
    return { ok: false, error: error?.message ?? "Could not update Autoenhance batch." };
  }

  if (lastError) {
    const uploads = await loadUploadSummaries(
      service,
      updated.id,
      admin.organizationId,
      updated.iguide_portal_id ?? undefined,
    );
    return { ok: true, batch: summarizeBatch(updated, uploads, []) };
  }

  return await refreshBookingAutoenhanceBatch({
    admin,
    bookingId: updated.booking_id,
    batchId: updated.id,
  });
}

export async function refreshBookingAutoenhanceBatch(input: Parameters<typeof refreshBookingAutoenhanceBatchWithinDeadline>[0]) {
  return withMediaDeadline(120_000, () => refreshBookingAutoenhanceBatchWithinDeadline(input));
}

async function refreshBookingAutoenhanceBatchWithinDeadline({
  admin,
  bookingId,
  batchId,
  preferredImageId,
}: {
  admin: AdminContext;
  bookingId?: string;
  batchId: string;
  preferredImageId?: string;
}): Promise<{ ok: true; batch: AutoenhanceBatchSummary } | { ok: false; error: string }> {
  await requirePhotoEditingProviderEnabled("autoenhance", admin.organizationId);
  const service = getServiceSupabase();
  const batch = await loadBatch(
    service,
    batchId,
    admin.organizationId,
    bookingId,
  );
  if (!batch) return { ok: false, error: "Autoenhance batch not found." };

  const booking = await loadBooking(service, batch.booking_id, admin.organizationId);
  const iguidePortalId = booking?.iguide_portal_id ?? batch.iguide_portal_id;

  let images: AutoenhanceImageResult[] = [];
  let processStatus = batch.process_status;
  let orderComplete = false;
  let lastError: string | null = null;
  try {
    const order = await getOrder(batch.order_id, admin.organizationId);
    processStatus = orderProcessStatus(order, processStatus);
    orderComplete = isOrderComplete(order);
    const rawImages = await rawImagesForOrder(
      batch.order_id,
      order,
      admin.organizationId,
      [...batch.finished_image_ids, ...(preferredImageId ? [preferredImageId] : [])],
    );
    images = await mapWithConcurrency(
      rawImages,
      6,
      async (raw, index) => {
        const imageId =
          stringField(raw, "image_id") ?? stringField(raw, "id") ?? `image-${index + 1}`;
        const image = await getImage(imageId, admin.organizationId).catch(() => raw);
        return formatImageResult(image, imageId);
      },
    );
  } catch (err) {
    lastError = errorMessage(err);
  }

  const finishedImages = images.filter(isFinishedImage);
  const failedImages = images.filter(isFailedImage);
  if (!lastError && failedImages.length) {
    lastError = failedImages
      .slice(0, 4)
      .map(
        (image) =>
          `${image.imageName}: ${image.statusReason ?? image.status ?? "Autoenhance failed"}`,
      )
      .join("; ");
  }
  const imagesToPush =
    preferredImageId && !orderComplete
      ? finishedImages.filter((image) => image.imageId === preferredImageId)
      : finishedImages;
  const push = iguidePortalId
    ? await pushFinishedImagesToIGuide({
        admin,
        batch,
        iguidePortalId,
        images: imagesToPush,
      })
    : {
        uploadedImageIds: batch.iguide_uploaded_image_ids,
        failedImageIds: batch.iguide_failed_image_ids,
        lastError: null,
      };

  const finishedImageIds = [
    ...new Set([
      ...batch.finished_image_ids,
      ...finishedImages.map((image) => image.imageId),
    ]),
  ];
  const nextStatus = nextBatchStatus({
    hasError: Boolean(lastError || push.lastError),
    hasProviderFailures: failedImages.length > 0,
    orderComplete,
    hasFinishedImages: finishedImageIds.length > 0,
    hasIGuide: Boolean(iguidePortalId),
    finishedCount: finishedImageIds.length,
    uploadedCount: push.uploadedImageIds.length,
    failedCount: push.failedImageIds.length,
  });

  const { data: updated, error } = await service
    .from("autoenhance_batches")
    .update({
      status: nextStatus,
      process_status: processStatus,
      finished_image_ids: finishedImageIds,
      iguide_portal_id: iguidePortalId,
      iguide_uploaded_image_ids: push.uploadedImageIds,
      iguide_failed_image_ids: push.failedImageIds,
      last_iguide_push_at:
        imagesToPush.length && iguidePortalId
          ? new Date().toISOString()
          : batch.last_iguide_push_at,
      last_error: lastError ?? push.lastError,
    })
    .eq("id", batch.id)
    .eq("organization_id", admin.organizationId)
    // The legacy update trigger versions the snapshot. A losing refresh yields;
    // it must never regress a newer receipt aggregate, portal, or status.
    .eq("updated_at", batch.updated_at)
    .select(
      "id, organization_id, booking_id, property_id, order_id, order_name, upload_mode, status, process_status, brackets_per_image, settings, bracket_ids, uploaded_image_ids, finished_image_ids, iguide_portal_id, iguide_uploaded_image_ids, iguide_failed_image_ids, last_iguide_push_at, last_error, created_by, created_at, updated_at",
    )
    .single<AutoenhanceBatchRow>();

  if (error || !updated) {
    return { ok: false, error: error?.message ?? "Could not save Autoenhance status." };
  }

  const uploads = await loadUploadSummaries(
    service,
    updated.id,
    admin.organizationId,
    updated.iguide_portal_id ?? undefined,
  );
  return { ok: true, batch: summarizeBatch(updated, uploads, images) };
}

export async function markBookingAutoenhanceBatchAttention({
  admin,
  bookingId,
  batchId,
  message,
}: {
  admin: AdminContext;
  bookingId: string;
  batchId: string;
  message: string;
}): Promise<{ ok: true; batch: AutoenhanceBatchSummary } | { ok: false; error: string }> {
  await requirePhotoEditingProviderEnabled("autoenhance", admin.organizationId);
  const service = getServiceSupabase();
  const batch = await loadBatch(
    service,
    batchId,
    admin.organizationId,
    bookingId,
  );
  if (!batch) return { ok: false, error: "Autoenhance batch not found." };

  const cleanMessage = message.trim().slice(0, 800) || "Photo upload did not finish.";
  const { data: updated, error } = await service
    .from("autoenhance_batches")
    .update({ status: "attention", last_error: cleanMessage })
    .eq("id", batch.id)
    .eq("organization_id", admin.organizationId)
    .eq("booking_id", bookingId)
    .select(
      "id, organization_id, booking_id, property_id, order_id, order_name, upload_mode, status, process_status, brackets_per_image, settings, bracket_ids, uploaded_image_ids, finished_image_ids, iguide_portal_id, iguide_uploaded_image_ids, iguide_failed_image_ids, last_iguide_push_at, last_error, created_by, created_at, updated_at",
    )
    .single<AutoenhanceBatchRow>();
  if (error || !updated) {
    return { ok: false, error: error?.message ?? "Could not save upload failure." };
  }
  const uploads = await loadUploadSummaries(
    service,
    updated.id,
    admin.organizationId,
    updated.iguide_portal_id ?? undefined,
  );
  return { ok: true, batch: summarizeBatch(updated, uploads, []) };
}

export async function listBookingAutoenhanceBatches({
  admin,
  bookingId,
}: {
  admin: AdminContext;
  bookingId: string;
}): Promise<AutoenhanceBatchSummary[]> {
  const service = getServiceSupabase();
  const { data: batches } = await service
    .from("autoenhance_batches")
    .select(
      "id, organization_id, booking_id, property_id, order_id, order_name, upload_mode, status, process_status, brackets_per_image, settings, bracket_ids, uploaded_image_ids, finished_image_ids, iguide_portal_id, iguide_uploaded_image_ids, iguide_failed_image_ids, last_iguide_push_at, last_error, created_by, created_at, updated_at",
    )
    .eq("booking_id", bookingId)
    .eq("organization_id", admin.organizationId)
    .order("created_at", { ascending: false })
    .limit(5)
    .returns<AutoenhanceBatchRow[]>();

  const rows = batches ?? [];
  const summaries = await Promise.all(
    rows.map(async (batch) => {
      const uploads = await loadUploadSummaries(
        service,
        batch.id,
        admin.organizationId,
        batch.iguide_portal_id ?? undefined,
      );
      return summarizeBatch(batch, uploads, []);
    }),
  );
  return summaries;
}

export async function syncPendingAutoenhanceBatches({
  limit = 1,
}: {
  limit?: number;
} = {}): Promise<{
  ok: true;
  checked: number;
  uploaded: number;
  failed: number;
  results: Array<{
    batchId: string;
    organizationId: string;
    status: string;
    uploadedCount: number;
    error: string | null;
  }>;
}> {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("Invalid recovery limit.");
  const batchLimit = Math.min(limit, 1);
  const service = getServiceSupabase();
  const { data: pending, error } = await service
    .from("autoenhance_batches")
    .select("id, organization_id, updated_at")
    .in("status", ["processing", "waiting_for_iguide", "attention"])
    .order("updated_at", { ascending: true })
    .limit(batchLimit)
    .returns<Array<PendingAutoenhanceBatchRow & { updated_at: string }>>();

  if (error) {
    throw new Error(error.message);
  }

  const results: Array<{
    batchId: string;
    organizationId: string;
    status: string;
    uploadedCount: number;
    error: string | null;
  }> = [];

  let scanned = 0;
  for (const batch of pending ?? []) {
    if (scanned++ >= batchLimit) break;
    // Rotate even disabled or failed work so the oldest tenant cannot starve the queue.
    // CAS makes overlapping selectors yield rather than both dispatch this snapshot.
    const rotated = await service.from("autoenhance_batches")
      .update({ id: batch.id }) // Existing set_updated_at trigger advances the timestamp.
      .eq("id", batch.id).eq("organization_id", batch.organization_id)
      .eq("updated_at", batch.updated_at).select("id").maybeSingle<{ id: string }>();
    if (rotated.error) throw new Error("Could not advance media recovery selection.");
    if (!rotated.data) continue;
    if (!(await isPhotoEditingProviderEnabled("autoenhance", batch.organization_id))) {
      continue;
    }
    const result = await refreshBookingAutoenhanceBatch({
      admin: {
        userId: "system:autoenhance",
        organizationId: batch.organization_id,
        email: "system@pixelbooking.local",
        fullName: "Autoenhance Sync",
      },
      batchId: batch.id,
    });

    if (result.ok) {
      results.push({
        batchId: batch.id,
        organizationId: batch.organization_id,
        status: result.batch.status,
        uploadedCount: result.batch.uploadedCount,
        error: result.batch.lastError,
      });
    } else {
      results.push({
        batchId: batch.id,
        organizationId: batch.organization_id,
        status: "failed",
        uploadedCount: 0,
        error: result.error,
      });
    }
  }

  return {
    ok: true,
    checked: results.length,
    uploaded: results.filter((result) => result.status === "iguide_uploaded")
      .length,
    failed: results.filter((result) => result.error).length,
    results,
  };
}

async function pushFinishedImagesToIGuide({
  admin,
  batch,
  iguidePortalId,
  images,
}: {
  admin: AdminContext;
  batch: AutoenhanceBatchRow;
  iguidePortalId: string;
  images: AutoenhanceImageResult[];
}): Promise<{ uploadedImageIds: string[]; failedImageIds: string[]; lastError: string | null }> {
  const service = getServiceSupabase();
  const existing = await loadUploadSummaries(
    service,
    batch.id,
    admin.organizationId,
    iguidePortalId,
  );
  const uploaded = new Set([
    ...(batch.iguide_portal_id === iguidePortalId
      ? batch.iguide_uploaded_image_ids
      : []),
    ...existing
      .filter((row) => row.status === "uploaded")
      .map((row) => row.imageId),
  ]);
  const failed = new Set(
    existing.filter((row) => row.status === "failed").map((row) => row.imageId),
  );
  let lastError: string | null = null;

  let attempted = 0;
  // Prioritize unclaimed work before ambiguous receipts. Bound external uploads,
  // not the original array prefix: completed/blocked rows must not hide later work.
  const known = new Map(existing.map((row) => [row.imageId, row]));
  const priority = (imageId: string) => {
    const row = known.get(imageId);
    return !row ? 0 : row.status === "failed" && /^media:retryable:[12]$/.test(row.warning ?? "") ? 1 : 2;
  };
  const candidates = images.filter((image) => !uploaded.has(image.imageId))
    .sort((a, b) => priority(a.imageId) - priority(b.imageId) ||
      (Date.parse(known.get(a.imageId)?.updatedAt ?? "") || 0) -
      (Date.parse(known.get(b.imageId)?.updatedAt ?? "") || 0));
  for (const image of candidates) {
    if (attempted >= 1) break;
    try { mediaSignal(1); } catch { lastError = "Media recovery deadline reached."; break; }
    if (uploaded.has(image.imageId)) continue;
    const filename = safePhotoFilename(image.imageName, image.imageId);
    let claim: { token: string; attempt: number } | false = false;
    let mutationStarted = false;
    try {
      const claimed = await claimIGuideUpload({
        admin,
        batch,
        iguidePortalId,
        imageId: image.imageId,
        filename,
      });
      if (!claimed) continue;
      claim = claimed;
      attempted++;

      const enhanced = await fetchEnhancedForIGuide(
        image.imageId,
        admin.organizationId,
      );
      const bytes = await enhanced.arrayBuffer();
      const result = await uploadAssetToIGuide(
        {
          iguideId: iguidePortalId,
          filename,
          bytes,
          contentType: enhanced.headers.get("content-type") ?? "image/jpeg",
          appendToViews: "default",
          waitForProcess: true,
          checkpoint: async (receipt) => {
            mutationStarted = true;
            await upsertIGuideUpload({ admin, batch, iguidePortalId,
              imageId: image.imageId, filename, status: "pending", claimToken: claimed.token,
              assetName: receipt.assetName, jobId: receipt.jid,
              error: "iGUIDE reconciliation required; do not upload again.",
            });
          },
        },
        { organizationId: admin.organizationId },
      );

      if (!result.ok || !result.data || result.outcome !== "completed") {
        failed.add(image.imageId);
        lastError = result.error ?? "iGUIDE upload failed.";
        await upsertIGuideUpload({
          status: "pending",
          claimToken: claimed.token,
          assetName: result.data?.assetName,
          jobId: result.data?.jid,
          admin,
          batch,
          iguidePortalId,
          imageId: image.imageId,
          filename,
          error: lastError,
        });
        continue;
      }

      await upsertIGuideUpload({
        status: "uploaded",
        claimToken: claimed.token,
        admin,
        batch,
        iguidePortalId,
        imageId: image.imageId,
        filename,
        assetName: result.data.assetName,
        jobId: result.data.jid,
        processComplete: result.data.processComplete,
        warning: result.data.processWarning ?? undefined,
      });
      uploaded.add(image.imageId);
      failed.delete(image.imageId);
    } catch {
      failed.add(image.imageId);
      lastError = mutationStarted ? "iGUIDE reconciliation required; do not upload again." : "Media handoff failed before iGUIDE mutation.";
      if (!claim) continue;
      await upsertIGuideUpload({
        status: mutationStarted ? "pending" : "failed",
        claimToken: claim.token,
        warning: mutationStarted ? undefined : `media:retryable:${claim.attempt}`,
        admin,
        batch,
        iguidePortalId,
        imageId: image.imageId,
        filename,
        error: lastError,
      }).catch((saveError) => {
        lastError = `${lastError} Could not save retry state: ${errorMessage(saveError)}`;
      });
    }
  }

  const latest = await loadUploadSummaries(
    service,
    batch.id,
    admin.organizationId,
    iguidePortalId,
  );
  for (const row of latest) {
    if (row.status === "uploaded") {
      uploaded.add(row.imageId);
      failed.delete(row.imageId);
    } else if (row.status === "failed") {
      failed.add(row.imageId);
    }
  }

  return {
    uploadedImageIds: [...uploaded],
    failedImageIds: [...failed],
    lastError,
  };
}

async function upsertIGuideUpload(input: {
  status: "uploaded" | "failed" | "pending";
  claimToken: string;
  admin: AdminContext;
  batch: AutoenhanceBatchRow;
  iguidePortalId: string;
  imageId: string;
  filename: string;
  assetName?: string;
  jobId?: string;
  processComplete?: boolean;
  warning?: string;
  error?: string;
}) {
  const service = getServiceSupabase();
  const { data, error } = await service.from("autoenhance_iguide_uploads").update(
    {
      organization_id: input.admin.organizationId,
      batch_id: input.batch.id,
      booking_id: input.batch.booking_id,
      iguide_portal_id: input.iguidePortalId,
      autoenhance_image_id: input.imageId,
      filename: input.filename,
      status: input.status,
      ...(input.assetName ? { iguide_asset_name: input.assetName } : {}),
      ...(input.jobId ? { iguide_job_id: input.jobId } : {}),
      ...(input.processComplete !== undefined ? { process_complete: input.processComplete } : {}),
      warning: input.warning ?? input.claimToken,
      error: input.error ?? null,
    },
  ).eq("organization_id", input.admin.organizationId)
    .eq("batch_id", input.batch.id).eq("iguide_portal_id", input.iguidePortalId)
    .eq("autoenhance_image_id", input.imageId).eq("status", "pending")
    .eq("warning", input.claimToken).select("id").maybeSingle<{ id: string }>();
  if (error || !data) throw new Error("Could not save fenced iGUIDE upload state.");
}

async function claimIGuideUpload(input: {
  admin: AdminContext;
  batch: AutoenhanceBatchRow;
  iguidePortalId: string;
  imageId: string;
  filename: string;
}): Promise<false | { token: string; attempt: number }> {
  const service = getServiceSupabase();
  const token = `media:claim:${randomUUID()}`;
  const inserted = await service
    .from("autoenhance_iguide_uploads")
    .insert({
      organization_id: input.admin.organizationId,
      batch_id: input.batch.id,
      booking_id: input.batch.booking_id,
      iguide_portal_id: input.iguidePortalId,
      autoenhance_image_id: input.imageId,
      filename: input.filename,
      status: "pending",
      warning: token,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (!inserted.error && inserted.data) return { token, attempt: 1 };
  if (inserted.error?.code !== "23505") {
    throw new Error(
      `Could not claim iGUIDE upload: ${inserted.error?.message ?? "Unknown database error"}`,
    );
  }

  const { data: existing, error: readError } = await service
    .from("autoenhance_iguide_uploads")
    .select("id, status, updated_at, warning, iguide_asset_name, iguide_job_id")
    .eq("organization_id", input.admin.organizationId)
    .eq("batch_id", input.batch.id)
    .eq("iguide_portal_id", input.iguidePortalId)
    .eq("autoenhance_image_id", input.imageId)
    .maybeSingle<{ id: string; status: string; updated_at: string; warning: string | null; iguide_asset_name: string | null; iguide_job_id: string | null }>();
  if (readError || !existing) {
    throw new Error(
      `Could not inspect iGUIDE upload claim: ${readError?.message ?? "Claim disappeared"}`,
    );
  }
  if (existing.status === "pending" && existing.iguide_asset_name && existing.iguide_job_id && existing.warning?.startsWith("media:claim:")) {
    // Rotate accepted polls before transport, including timeout/nonterminal cases.
    // Keep the same claim and accepted identity: this is never a re-upload lease.
    await upsertIGuideUpload({ ...input, claimToken: existing.warning, status: "pending",
      error: "iGUIDE reconciliation required; do not upload again." });
    const checked = await getUploadProcessingStatus(input.iguidePortalId, existing.iguide_asset_name, { organizationId: input.admin.organizationId });
    if (checked.ok && checked.status === 204) {
      await upsertIGuideUpload({ ...input, claimToken: existing.warning, status: "uploaded", processComplete: true });
    }
    return false;
  }
  if (existing.status !== "failed" || !/^media:retryable:[12]$/.test(existing.warning ?? "")) return false;

  const updatedAt = Date.parse(existing.updated_at);
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt < 15 * 60 * 1000) return false;

  const { data: reclaimed, error: reclaimError } = await service
    .from("autoenhance_iguide_uploads")
    .update({
      filename: input.filename,
      status: "pending",
      warning: token,
      error: null,
      process_complete: null,
    })
    .eq("id", existing.id)
    .eq("organization_id", input.admin.organizationId)
    .eq("status", "failed")
    .eq("warning", existing.warning!)
    .eq("updated_at", existing.updated_at)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (reclaimError) {
    throw new Error(`Could not reclaim iGUIDE upload: ${reclaimError.message}`);
  }
  return reclaimed ? { token, attempt: Number(existing.warning!.split(":")[2]) + 1 } : false;
}

async function fetchEnhancedForIGuide(
  imageId: string,
  organizationId: string,
): Promise<Response> {
  try {
    return await fetchEnhancedImage(imageId, {
      organizationId,
      format: "jpeg",
      quality: 90,
      preview: false,
    });
  } catch (err) {
    if (err instanceof AutoenhanceError && err.status === 402) {
      throw new Error(
        "Autoenhance did not allow a full-resolution download for this photo. Nothing was sent to iGUIDE; check the Autoenhance plan or credits, then refresh this batch.",
      );
    }
    throw err;
  }
}

async function loadBooking(
  service: ReturnType<typeof getServiceSupabase>,
  bookingId: string,
  organizationId: string,
): Promise<BookingAutoenhanceRow | null> {
  const { data, error } = await service
    .from("bookings")
    .select(
      "id, organization_id, property_id, iguide_portal_id, properties(street_address, city)",
    )
    .eq("id", bookingId)
    .eq("organization_id", organizationId)
    .maybeSingle<BookingAutoenhanceRow>();
  if (error) return null;
  return data ?? null;
}

async function loadBatch(
  service: ReturnType<typeof getServiceSupabase>,
  batchId: string,
  organizationId: string,
  bookingId?: string,
): Promise<AutoenhanceBatchRow | null> {
  let query = service
    .from("autoenhance_batches")
    .select(
      "id, organization_id, booking_id, property_id, order_id, order_name, upload_mode, status, process_status, brackets_per_image, settings, bracket_ids, uploaded_image_ids, finished_image_ids, iguide_portal_id, iguide_uploaded_image_ids, iguide_failed_image_ids, last_iguide_push_at, last_error, created_by, created_at, updated_at",
    )
    .eq("id", batchId)
    .eq("organization_id", organizationId);
  if (bookingId) query = query.eq("booking_id", bookingId);
  const { data, error } = await query.maybeSingle<AutoenhanceBatchRow>();
  if (error) return null;
  return data ?? null;
}

async function loadUploadSummaries(
  service: ReturnType<typeof getServiceSupabase>,
  batchId: string,
  organizationId: string,
  iguidePortalId?: string,
): Promise<AutoenhanceIGuideUploadSummary[]> {
  let query = service
    .from("autoenhance_iguide_uploads")
    .select(
      "id, autoenhance_image_id, filename, status, warning, error, process_complete, updated_at",
    )
    .eq("batch_id", batchId)
    .eq("organization_id", organizationId);
  if (iguidePortalId) query = query.eq("iguide_portal_id", iguidePortalId);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .returns<AutoenhanceUploadRow[]>();
  if (error) throw new Error(`Could not load iGUIDE upload history: ${error.message}`);
  return (data ?? []).map((row) => ({
    imageId: row.autoenhance_image_id,
    filename: row.filename,
    status: row.status,
    warning: row.warning,
    error: row.error,
    processComplete: row.process_complete,
    updatedAt: row.updated_at,
  }));
}

async function rawImagesForOrder(
  orderId: string,
  order: unknown,
  organizationId: string,
  knownImageIds: string[] = [],
): Promise<Array<Record<string, unknown>>> {
  const primary = extractOrderImages(order);
  const brackets = await getOrderBrackets(orderId, organizationId).catch(() => null);
  return mergeImageRecords(
    primary,
    [
      ...(brackets?.brackets
        ?.filter((bracket) => bracket.image_id)
        .map((bracket) => ({
          image_id: bracket.image_id,
          image_name: bracket.name,
          bracket_id: bracket.bracket_id,
          status: "processing",
        })) ?? []),
      ...knownImageIds.map((imageId) => ({
        image_id: imageId,
        image_name: imageId,
        status: "processed",
      })),
    ],
  );
}

function summarizeBatch(
  batch: AutoenhanceBatchRow,
  uploads: AutoenhanceIGuideUploadSummary[],
  images: AutoenhanceImageResult[],
): AutoenhanceBatchSummary {
  return {
    id: batch.id,
    bookingId: batch.booking_id,
    orderId: batch.order_id,
    orderName: batch.order_name,
    uploadMode: batch.upload_mode,
    status: batch.status,
    processStatus: batch.process_status,
    bracketsPerImage: batch.brackets_per_image,
    finishedImageIds: batch.finished_image_ids,
    iguidePortalId: batch.iguide_portal_id,
    iguideUploadedImageIds: batch.iguide_uploaded_image_ids,
    iguideFailedImageIds: batch.iguide_failed_image_ids,
    uploadedCount: batch.iguide_uploaded_image_ids.length,
    failedCount: batch.iguide_failed_image_ids.length,
    lastError: batch.last_error,
    createdAt: batch.created_at,
    updatedAt: batch.updated_at,
    images,
    uploads,
  };
}

function normalizeSettings(
  value: AutoenhanceWorkflowSettingsInput | Json | null,
): AutoenhanceWorkflowSettings {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    uploadMode: record.uploadMode === "single" ? "single" : "hdr",
    enhanceType: normalizeEnhanceType(record.enhanceType),
    presetId:
      typeof record.presetId === "string" && record.presetId.trim()
        ? record.presetId.trim()
        : undefined,
    skyReplacement: Boolean(record.skyReplacement),
    cloudType: normalizeCloudType(record.cloudType),
    windowPullType: normalizeWindowPullType(record.windowPullType),
    privacy: record.privacy !== false,
    upscale: Boolean(record.upscale),
    tripodHide: Boolean(record.tripodHide),
    fireInFireplaces: Boolean(record.fireInFireplaces),
    greenGrass: Boolean(record.greenGrass),
    removePhotographer: Boolean(record.removePhotographer),
    blackOutTvs: Boolean(record.blackOutTvs),
    bracketsPerImage: normalizeBracketsPerImage(record.bracketsPerImage),
  };
}

function settingsToJson(settings: AutoenhanceWorkflowSettings): Json {
  return {
    uploadMode: settings.uploadMode,
    enhanceType: settings.enhanceType,
    ...(settings.presetId ? { presetId: settings.presetId } : {}),
    skyReplacement: settings.skyReplacement,
    cloudType: settings.cloudType,
    windowPullType: settings.windowPullType,
    privacy: settings.privacy,
    upscale: settings.upscale,
    tripodHide: settings.tripodHide,
    fireInFireplaces: settings.fireInFireplaces,
    greenGrass: settings.greenGrass,
    removePhotographer: settings.removePhotographer,
    blackOutTvs: settings.blackOutTvs,
    bracketsPerImage: settings.bracketsPerImage,
  };
}

function restageOptions(
  settings: AutoenhanceWorkflowSettings,
): AutoenhanceRestageOptions | null {
  const restage: AutoenhanceRestageOptions = {
    ...(settings.fireInFireplaces ? { fire_in_fireplaces: "ALIGHT" } : {}),
    ...(settings.greenGrass ? { grass: "GREEN" } : {}),
    ...(settings.removePhotographer ? { photographer: "REMOVE" } : {}),
    ...(settings.blackOutTvs ? { tvs: "BLACK_OUT" } : {}),
  };
  return Object.keys(restage).length ? restage : null;
}

function normalizeEnhanceType(value: unknown): AutoenhanceEnhanceType {
  return value === "property" ||
    value === "property_usa" ||
    value === "neutral" ||
    value === "modern"
    ? value
    : "warm";
}

function normalizeCloudType(value: unknown): AutoenhanceCloudType | null {
  return value === "CLEAR" || value === "LOW_CLOUD" || value === "HIGH_CLOUD"
    ? value
    : null;
}

function normalizeWindowPullType(
  value: unknown,
): AutoenhanceWindowPullType | null {
  return value === "NONE" ||
    value === "ONLY_WINDOWS" ||
    value === "WINDOWS_WITH_SKIES"
    ? value
    : null;
}

function normalizeBracketsPerImage(value: unknown): number {
  const parsed = Number(value);
  if (parsed === 0) return 0;
  return parsed === 1 || parsed === 3 || parsed === 5 || parsed === 7
    ? parsed
    : 0;
}

function formatImageResult(
  image: unknown,
  fallbackName: string,
): AutoenhanceImageResult {
  const record = isRecord(image) ? image : {};
  const imageId = stringField(record, "image_id") ?? fallbackName;
  return {
    imageId,
    imageName:
      stringField(record, "image_name") ??
      stringField(record, "name") ??
      fallbackName,
    status: stringField(record, "status"),
    statusReason: stringField(record, "status_reason"),
    scene: stringField(record, "scene"),
    enhanced: Boolean(record.enhanced),
    enhancedProxyUrl: `/api/autoenhance-test/enhanced/${encodeURIComponent(
      imageId,
    )}`,
  };
}

function isFinishedImage(image: AutoenhanceImageResult): boolean {
  if (image.imageId.startsWith("bracket")) return false;
  if (image.enhanced) return true;
  const status = image.status?.toLowerCase() ?? "";
  return ["complete", "completed", "processed", "done", "finished"].some((word) =>
    status.includes(word),
  );
}

function isFailedImage(image: AutoenhanceImageResult): boolean {
  const status = image.status?.toLowerCase() ?? "";
  return ["error", "failed", "expired"].some((word) => status.includes(word));
}

function orderProcessStatus(order: unknown, fallback: string | null): string | null {
  if (!isRecord(order)) return fallback;
  if (order.is_merging === true) return "merging";
  if (order.is_processing === true) return "processing";
  return stringField(order, "status") ?? fallback;
}

function isOrderComplete(order: unknown): boolean {
  if (!isRecord(order)) return false;
  if (order.is_merging === true || order.is_processing === true) return false;
  if (order.is_merging === false && order.is_processing === false) return true;
  const status = stringField(order, "status")?.toLowerCase() ?? "";
  return ["complete", "completed", "processed", "done", "finished"].some(
    (word) => status.includes(word),
  );
}

function nextBatchStatus(input: {
  hasError: boolean;
  hasProviderFailures: boolean;
  orderComplete: boolean;
  hasFinishedImages: boolean;
  hasIGuide: boolean;
  finishedCount: number;
  uploadedCount: number;
  failedCount: number;
}) {
  if (input.hasProviderFailures || input.failedCount > 0) {
    return "attention";
  }
  if (!input.orderComplete) return "processing";
  if (input.hasError) return "attention";
  if (!input.hasFinishedImages) return "attention";
  if (!input.hasIGuide) return "waiting_for_iguide";
  if (input.uploadedCount >= input.finishedCount) return "iguide_uploaded";
  return "processing";
}

function buildOrderName(booking: BookingAutoenhanceRow) {
  const address = [
    booking.properties?.street_address,
    booking.properties?.city,
  ]
    .filter(Boolean)
    .join(", ");
  return address ? `Autoenhance · ${address}` : `Autoenhance · ${booking.id}`;
}

function safePhotoFilename(
  name: string,
  imageId: string,
) {
  const cleaned = name
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${cleaned || `autoenhance-${imageId}`}.jpg`;
}

function extractOrderImages(value: unknown): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  visit(value, found);
  return dedupeImages(found);
}

function visit(
  value: unknown,
  found: Array<Record<string, unknown>>,
  parentKey?: string,
) {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, found, parentKey);
    return;
  }
  if (typeof value === "string" && parentKey && imageContainerKey(parentKey)) {
    const trimmed = value.trim();
    if (trimmed) found.push({ image_id: trimmed, image_name: trimmed });
    return;
  }
  if (!isRecord(value)) return;

  const imageId =
    stringField(value, "image_id") ??
    (parentKey && imageContainerKey(parentKey)
      ? stringField(value, "id")
      : null);
  if (imageId) found.push({ ...value, image_id: imageId });

  for (const key of ["images", "image_ids", "items", "results", "data", "brackets"]) {
    if (key in value) visit(value[key], found, key);
  }
}

function dedupeImages(
  images: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const image of images) {
    const id = stringField(image, "image_id");
    if (!id) continue;
    byId.set(id, { ...byId.get(id), ...image });
  }
  return [...byId.values()];
}

function mergeImageRecords(
  primary: Array<Record<string, unknown>>,
  fallback: Array<Record<string, unknown>>,
) {
  return dedupeImages([...fallback, ...primary]);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker),
  );
  return results;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function imageContainerKey(key: string) {
  return key === "images" || key === "image_ids";
}

function errorMessage(error: unknown): string {
  if (!isRecord(error)) {
    return error instanceof Error ? error.message : String(error);
  }
  const base =
    error instanceof Error
      ? error.message
      : typeof error.message === "string"
        ? error.message
        : String(error);
  return base;
}
