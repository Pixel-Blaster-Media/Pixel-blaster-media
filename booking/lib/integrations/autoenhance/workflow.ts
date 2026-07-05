import "server-only";

import type { AdminContext } from "@/lib/auth/require-admin";
import {
  AutoenhanceError,
  createBracket,
  createImage,
  createOrder,
  fetchEnhancedImage,
  getImage,
  getOrder,
  getOrderBrackets,
  processOrder,
  type AutoenhanceCloudType,
  type AutoenhanceEnhanceType,
  type AutoenhanceImage,
  type AutoenhanceRestageOptions,
  type AutoenhanceWindowPullType,
} from "@/lib/integrations/autoenhance/client";
import { uploadAssetToIGuide } from "@/lib/integrations/iguide/portal-client";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

export type AutoenhanceUploadMode = "hdr" | "single";

export type AutoenhanceWorkflowSettings = {
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

export type AutoenhanceImageResult = {
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

export type AutoenhanceIGuideUploadSummary = {
  imageId: string;
  filename: string;
  status: "pending" | "uploaded" | "failed";
  warning: string | null;
  error: string | null;
  processComplete: boolean | null;
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
  autoenhance_image_id: string;
  filename: string;
  status: "pending" | "uploaded" | "failed";
  warning: string | null;
  error: string | null;
  process_complete: boolean | null;
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
  const cleanedFileNames = fileNames
    .map((name) => String(name).trim())
    .filter(Boolean)
    .slice(0, 160);
  if (!cleanedFileNames.length) return { ok: false, error: "Pick at least one image." };

  const service = getServiceSupabase();
  const booking = await loadBooking(service, bookingId, admin.organizationId);
  if (!booking) return { ok: false, error: "Booking not found." };

  const normalized = normalizeSettings(settings);
  const orderName = buildOrderName(booking);
  const order = await createOrder(orderName, admin.organizationId);
  if (!order.order_id) {
    return { ok: false, error: "Autoenhance did not return an order ID." };
  }

  const uploads: AutoenhancePreparedUpload[] = [];
  for (const fileName of cleanedFileNames) {
    if (normalized.uploadMode === "single") {
      const image = await createImage(
        {
          orderId: order.order_id,
          imageName: fileName,
          enhanceType: normalized.enhanceType,
          presetId: normalized.presetId,
          skyReplacement: normalized.skyReplacement,
          cloudType: normalized.cloudType,
          windowPullType: normalized.windowPullType,
          privacy: normalized.privacy,
          upscale: normalized.upscale,
          tripodHide: normalized.tripodHide,
          restage: restageOptions(normalized),
        },
        admin.organizationId,
      );
      if (!image.image_id || !image.upload_url) {
        return {
          ok: false,
          error: `Autoenhance did not return an upload URL for ${fileName}.`,
        };
      }
      uploads.push({
        ...formatImageResult(image, fileName),
        uploadKind: "image",
        uploadUrl: image.upload_url,
      });
      continue;
    }

    const bracket = await createBracket(
      { orderId: order.order_id, name: fileName },
      admin.organizationId,
    );
    if (!bracket.bracket_id || !bracket.upload_url) {
      return {
        ok: false,
        error: `Autoenhance did not return a bracket upload URL for ${fileName}.`,
      };
    }
    uploads.push({
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
    });
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
    return { ok: false, error: error?.message ?? "Could not save Autoenhance batch." };
  }

  return {
    ok: true,
    batch: summarizeBatch(batch, [], uploads),
    uploads,
  };
}

export async function startBookingAutoenhanceProcessing({
  admin,
  batchId,
  uploadedBracketIds,
  uploadedImageIds,
}: {
  admin: AdminContext;
  batchId: string;
  uploadedBracketIds: string[];
  uploadedImageIds: string[];
}): Promise<{ ok: true; batch: AutoenhanceBatchSummary } | { ok: false; error: string }> {
  const service = getServiceSupabase();
  const batch = await loadBatch(service, batchId, admin.organizationId);
  if (!batch) return { ok: false, error: "Autoenhance batch not found." };

  const settings = normalizeSettings(batch.settings);
  const cleanBracketIds = uploadedBracketIds.map(String).filter(Boolean);
  const cleanImageIds = uploadedImageIds.map(String).filter(Boolean);

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
      processStatus = processed.status ?? processStatus;
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

  return await refreshBookingAutoenhanceBatch({
    admin,
    batchId: updated.id,
  });
}

export async function refreshBookingAutoenhanceBatch({
  admin,
  batchId,
}: {
  admin: AdminContext;
  batchId: string;
}): Promise<{ ok: true; batch: AutoenhanceBatchSummary } | { ok: false; error: string }> {
  const service = getServiceSupabase();
  const batch = await loadBatch(service, batchId, admin.organizationId);
  if (!batch) return { ok: false, error: "Autoenhance batch not found." };

  const booking = await loadBooking(service, batch.booking_id, admin.organizationId);
  const iguidePortalId = booking?.iguide_portal_id ?? batch.iguide_portal_id;

  let images: AutoenhanceImageResult[] = [];
  let processStatus = batch.process_status;
  let lastError: string | null = null;
  try {
    const order = await getOrder(batch.order_id, admin.organizationId);
    processStatus = order.status ?? processStatus;
    const rawImages = await rawImagesForOrder(batch.order_id, order, admin.organizationId);
    images = await Promise.all(
      rawImages.map(async (raw, index) => {
        const imageId =
          stringField(raw, "image_id") ?? stringField(raw, "id") ?? `image-${index + 1}`;
        const image = await getImage(imageId, admin.organizationId).catch(() => raw);
        return formatImageResult(image, imageId);
      }),
    );
  } catch (err) {
    lastError = errorMessage(err);
  }

  const finishedImages = images.filter(isFinishedImage);
  const push = iguidePortalId
    ? await pushFinishedImagesToIGuide({
        admin,
        batch,
        iguidePortalId,
        images: finishedImages,
      })
    : { uploadedImageIds: batch.iguide_uploaded_image_ids, failedImageIds: batch.iguide_failed_image_ids, lastError: null };

  const finishedImageIds = finishedImages.map((image) => image.imageId);
  const nextStatus = nextBatchStatus({
    hasError: Boolean(lastError || push.lastError),
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
      last_iguide_push_at: finishedImageIds.length && iguidePortalId ? new Date().toISOString() : batch.last_iguide_push_at,
      last_error: lastError ?? push.lastError,
    })
    .eq("id", batch.id)
    .eq("organization_id", admin.organizationId)
    .select(
      "id, organization_id, booking_id, property_id, order_id, order_name, upload_mode, status, process_status, brackets_per_image, settings, bracket_ids, uploaded_image_ids, finished_image_ids, iguide_portal_id, iguide_uploaded_image_ids, iguide_failed_image_ids, last_iguide_push_at, last_error, created_by, created_at, updated_at",
    )
    .single<AutoenhanceBatchRow>();

  if (error || !updated) {
    return { ok: false, error: error?.message ?? "Could not save Autoenhance status." };
  }

  const uploads = await loadUploadSummaries(service, updated.id, admin.organizationId);
  return { ok: true, batch: summarizeBatch(updated, uploads, images) };
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
      const uploads = await loadUploadSummaries(service, batch.id, admin.organizationId);
      return summarizeBatch(batch, uploads, []);
    }),
  );
  return summaries;
}

export async function syncPendingAutoenhanceBatches({
  limit = 10,
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
  const service = getServiceSupabase();
  const { data: pending, error } = await service
    .from("autoenhance_batches")
    .select("id, organization_id")
    .in("status", ["processing", "waiting_for_iguide"])
    .order("updated_at", { ascending: true })
    .limit(limit)
    .returns<PendingAutoenhanceBatchRow[]>();

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

  for (const batch of pending ?? []) {
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
  const existing = await loadUploadSummaries(service, batch.id, admin.organizationId);
  const uploaded = new Set([
    ...batch.iguide_uploaded_image_ids,
    ...existing
      .filter((row) => row.status === "uploaded")
      .map((row) => row.imageId),
  ]);
  const failed = new Set(
    existing.filter((row) => row.status === "failed").map((row) => row.imageId),
  );
  let lastError: string | null = null;

  for (const image of images) {
    if (uploaded.has(image.imageId)) continue;
    try {
      const enhancedResult = await fetchEnhancedForIGuide(
        image.imageId,
        admin.organizationId,
      );
      const enhanced = enhancedResult.response;
      const bytes = await enhanced.arrayBuffer();
      const filename = safePhotoFilename(
        image.imageName,
        image.imageId,
        enhancedResult.usedPreview,
      );
      const result = await uploadAssetToIGuide(
        {
          iguideId: iguidePortalId,
          filename,
          bytes,
          contentType: enhanced.headers.get("content-type") ?? "image/jpeg",
          appendToViews: "default",
          waitForProcess: true,
        },
        { organizationId: admin.organizationId },
      );

      if (!result.ok || !result.data) {
        failed.add(image.imageId);
        lastError = result.error ?? "iGUIDE upload failed.";
        await upsertIGuideUpload({
          status: "failed",
          admin,
          batch,
          iguidePortalId,
          imageId: image.imageId,
          filename,
          error: lastError,
        });
        continue;
      }

      uploaded.add(image.imageId);
      failed.delete(image.imageId);
      await upsertIGuideUpload({
        status: "uploaded",
        admin,
        batch,
        iguidePortalId,
        imageId: image.imageId,
        filename,
        assetName: result.data.assetName,
        jobId: result.data.jid,
        processComplete: result.data.processComplete,
        warning: [enhancedResult.warning, result.data.processWarning]
          .filter(Boolean)
          .join(" "),
      });
    } catch (err) {
      failed.add(image.imageId);
      lastError = errorMessage(err);
      await upsertIGuideUpload({
        status: "failed",
        admin,
        batch,
        iguidePortalId,
        imageId: image.imageId,
        filename: safePhotoFilename(image.imageName, image.imageId, false),
        error: lastError,
      });
    }
  }

  return {
    uploadedImageIds: [...uploaded],
    failedImageIds: [...failed],
    lastError,
  };
}

async function upsertIGuideUpload(input: {
  status: "uploaded" | "failed";
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
  await service.from("autoenhance_iguide_uploads").upsert(
    {
      organization_id: input.admin.organizationId,
      batch_id: input.batch.id,
      booking_id: input.batch.booking_id,
      iguide_portal_id: input.iguidePortalId,
      autoenhance_image_id: input.imageId,
      filename: input.filename,
      status: input.status,
      iguide_asset_name: input.assetName ?? null,
      iguide_job_id: input.jobId ?? null,
      process_complete: input.processComplete ?? null,
      warning: input.warning || null,
      error: input.error ?? null,
    },
    {
      onConflict:
        "organization_id,batch_id,iguide_portal_id,autoenhance_image_id",
    },
  );
}

async function fetchEnhancedForIGuide(
  imageId: string,
  organizationId: string,
): Promise<{ response: Response; usedPreview: boolean; warning?: string }> {
  try {
    return {
      response: await fetchEnhancedImage(imageId, {
        organizationId,
        format: "jpeg",
        quality: 90,
        preview: false,
      }),
      usedPreview: false,
    };
  } catch (err) {
    if (!(err instanceof AutoenhanceError) || err.status !== 402) throw err;
    try {
      return {
        response: await fetchEnhancedImage(imageId, {
          organizationId,
          format: "jpeg",
          quality: 90,
          preview: false,
          devMode: true,
        }),
        usedPreview: false,
        warning:
          "Autoenhance full-resolution download returned 402/no plan, so development mode was used. Do not use this for client delivery until the Autoenhance plan allows full-resolution downloads.",
      };
    } catch {
      return {
        response: await fetchEnhancedImage(imageId, {
          organizationId,
          format: "jpeg",
          quality: 85,
          preview: true,
        }),
        usedPreview: true,
        warning:
          "Autoenhance full-resolution download returned 402/no plan, so a preview image was uploaded. Do not use this for client delivery until the Autoenhance plan allows full-resolution downloads.",
      };
    }
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
): Promise<AutoenhanceBatchRow | null> {
  const { data, error } = await service
    .from("autoenhance_batches")
    .select(
      "id, organization_id, booking_id, property_id, order_id, order_name, upload_mode, status, process_status, brackets_per_image, settings, bracket_ids, uploaded_image_ids, finished_image_ids, iguide_portal_id, iguide_uploaded_image_ids, iguide_failed_image_ids, last_iguide_push_at, last_error, created_by, created_at, updated_at",
    )
    .eq("id", batchId)
    .eq("organization_id", organizationId)
    .maybeSingle<AutoenhanceBatchRow>();
  if (error) return null;
  return data ?? null;
}

async function loadUploadSummaries(
  service: ReturnType<typeof getServiceSupabase>,
  batchId: string,
  organizationId: string,
): Promise<AutoenhanceIGuideUploadSummary[]> {
  const { data } = await service
    .from("autoenhance_iguide_uploads")
    .select(
      "autoenhance_image_id, filename, status, warning, error, process_complete",
    )
    .eq("batch_id", batchId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .returns<AutoenhanceUploadRow[]>();
  return (data ?? []).map((row) => ({
    imageId: row.autoenhance_image_id,
    filename: row.filename,
    status: row.status,
    warning: row.warning,
    error: row.error,
    processComplete: row.process_complete,
  }));
}

async function rawImagesForOrder(
  orderId: string,
  order: unknown,
  organizationId: string,
): Promise<Array<Record<string, unknown>>> {
  const primary = extractOrderImages(order);
  const brackets = await getOrderBrackets(orderId, organizationId).catch(() => null);
  return mergeImageRecords(
    primary,
    brackets?.brackets
      ?.filter((bracket) => bracket.image_id)
      .map((bracket) => ({
        image_id: bracket.image_id,
        image_name: bracket.name,
        bracket_id: bracket.bracket_id,
        status: "processing",
      })) ?? [],
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
  return parsed === 1 || parsed === 5 || parsed === 7 ? parsed : 3;
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

function nextBatchStatus(input: {
  hasError: boolean;
  hasFinishedImages: boolean;
  hasIGuide: boolean;
  finishedCount: number;
  uploadedCount: number;
  failedCount: number;
}) {
  if (input.hasError || input.failedCount > 0) return "attention";
  if (!input.hasFinishedImages) return "processing";
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
  preview: boolean,
) {
  const cleaned = name
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${cleaned || `autoenhance-${imageId}`}${preview ? "-preview" : ""}.jpg`;
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

  const imageId = stringField(value, "image_id") ?? stringField(value, "id");
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
  return dedupeImages([...primary, ...fallback]);
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
  const body = typeof error.body === "string" ? error.body.trim() : "";
  if (!body) return base;
  return `${base}: ${body.slice(0, 500)}`;
}
