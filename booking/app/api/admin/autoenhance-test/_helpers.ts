import { NextResponse } from "next/server";

export type TestImageResult = {
  bracketId?: string;
  imageId: string;
  imageName: string;
  status: string | null;
  statusReason: string | null;
  scene: string | null;
  enhancedProxyUrl: string;
};

export type PreparedUpload = TestImageResult & {
  uploadKind: "image" | "bracket";
  bracketId?: string;
  uploadUrl: string;
};

export function jsonError(error: unknown, status = 500) {
  const message = errorMessage(error);
  return NextResponse.json(
    {
      ok: false,
      error: message,
    },
    { status },
  );
}

export function normalizeBracketsPerImage(value: unknown): number {
  const parsed = Number(value);
  if (parsed === 0) return 0;
  return parsed === 1 || parsed === 5 || parsed === 7 ? parsed : 3;
}

export function formatImageResult(
  image: unknown,
  fallbackName: string,
): TestImageResult {
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
    enhancedProxyUrl: `/api/autoenhance-test/enhanced/${encodeURIComponent(
      imageId,
    )}`,
  };
}

export function pendingBracketGroup(
  bracketIds: string[],
  bracketsPerImage: number,
): TestImageResult {
  const id = `brackets:${bracketIds.join(",")}`;
  const estimatedCount = Math.ceil(bracketIds.length / bracketsPerImage);
  return {
    imageId: id,
    imageName: `Fixed ${bracketsPerImage}-bracket HDR batch (${bracketIds.length} files, about ${estimatedCount} finished photo${estimatedCount === 1 ? "" : "s"})`,
    status: "processing",
    statusReason:
      "Autoenhance has the uploaded bracket files and is grouping them by the fixed bracket count. Refresh the order after processing finishes.",
    scene: null,
    enhancedProxyUrl: "",
  };
}

export function pendingAutoBracketGroup(bracketIds: string[]): TestImageResult {
  return {
    imageId: `brackets:auto:${bracketIds.join(",")}`,
    imageName: `Auto-detected HDR batch (${bracketIds.length} files)`,
    status: "waiting",
    statusReason:
      "Autoenhance has the uploaded bracket files, but has not returned finished HDR photo IDs yet. Refresh the order after processing finishes.",
    scene: null,
    enhancedProxyUrl: "",
  };
}

export function extractOrderImages(value: unknown): Array<Record<string, unknown>> {
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
  if (imageId) {
    found.push({
      ...value,
      image_id: imageId,
    });
  }

  for (const key of [
    "images",
    "image_ids",
    "items",
    "results",
    "data",
    "brackets",
  ]) {
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
    byId.set(id, image);
  }
  return [...byId.values()];
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
