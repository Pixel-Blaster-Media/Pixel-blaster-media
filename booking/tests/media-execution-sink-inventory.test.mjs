import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const inventoryPath = join(root, "docs/MEDIA_EXECUTION_SINK_INVENTORY.md");

function inventory() {
  return readFileSync(inventoryPath, "utf8");
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const IGUIDE_BOOKING_OPERATIONS = new Set([
  "saveIGuideId",
  "syncIGuide",
  "createIGuideForBooking",
  "listExistingIGuides",
]);

function syntaxAwareIGuideDetectors(path, source) {
  const scriptKind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
  const detectors = [];

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && IGUIDE_BOOKING_OPERATIONS.has(node.expression.text)) {
      detectors.push(`iguide-booking-call:${node.expression.text}`);
    }
    if (ts.isFunctionDeclaration(node) && node.name && IGUIDE_BOOKING_OPERATIONS.has(node.name.text)) {
      const modifiers = node.modifiers ?? [];
      const exported = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      const asynchronous = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
      if (exported && asynchronous) detectors.push(`iguide-booking-definition:${node.name.text}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return [...detectors];
}

function mediaDetectors(path, source) {
  const normalized = relative(root, path).replaceAll("\\", "/");
  const providerPath = /(?:autoenhance|fotello|iguide)/i.test(normalized);
  const displayPath = /app\/(?:portal|listings)\//.test(normalized);
  const detectors = [];

  if (providerPath && /\bfetch\s*\(/.test(source)) detectors.push("provider-fetch");
  if (/new NextResponse\([^)]*\.body|new NextResponse\([\s\S]{0,120}?\.body/.test(source)) detectors.push("streamed-response");
  if (/\.arrayBuffer\s*\(\)/.test(source)) detectors.push("byte-buffer");
  if (/\.from\(["']deliverables["']\)[\s\S]{0,500}?\.(?:insert|upsert|delete)\s*\(/.test(source)) detectors.push("deliverable-write-or-delete");
  if (/\.storage\.from\s*\(/.test(source)) detectors.push("managed-storage");
  if (providerPath && /NextResponse\.redirect\s*\(/.test(source)) detectors.push("provider-redirect");
  if ((providerPath || displayPath) && /<iframe|embed_html/.test(source)) detectors.push("media-embed");
  if (providerPath && /<form\b[\s\S]*?action=/.test(source) && /(?:iguide_ref|event_id|linkManualIGuideToBooking|linkIGuideWebhookEvent)/.test(source)) {
    detectors.push("provider-identifier-form");
  }
  detectors.push(...syntaxAwareIGuideDetectors(path, source));

  return detectors.map((detector) => `${normalized} :: ${detector}`);
}

test("iGUIDE discovery ignores comments, strings, and declarations when proving calls", () => {
  const synthetic = [
    "// saveIGuideId(); syncIGuide();",
    'const text = "createIGuideForBooking(); listExistingIGuides();";',
    "const template = `saveIGuideId(); syncIGuide();`;",
    "async function syncIGuide() {}",
    "const createIGuideForBooking = () => {};",
    "export async function saveIGuideId() { return text; }",
    "const live = `${listExistingIGuides()}`;",
  ].join("\n");
  assert.deepEqual(syntaxAwareIGuideDetectors("synthetic.ts", synthetic), [
    "iguide-booking-definition:saveIGuideId",
    "iguide-booking-call:listExistingIGuides",
  ]);
});

test("repository-backed media sink discovery is represented in the reviewed inventory", () => {
  const document = inventory();
  const discoveries = [join(root, "app"), join(root, "lib")]
    .flatMap(sourceFiles)
    .flatMap((path) => mediaDetectors(path, readFileSync(path, "utf8")));

  assert.ok(discoveries.length > 15, "discovery rules must find the current media surface");
  const bookingUi = "app/admin/bookings/[id]/IGuideSection.tsx";
  const bookingActions = "app/admin/bookings/[id]/actions.ts";
  const expectedUiCalls = {
    saveIGuideId: 4,
    syncIGuide: 2,
    createIGuideForBooking: 1,
    listExistingIGuides: 1,
  };
  for (const [operation, expectedCount] of Object.entries(expectedUiCalls)) {
    assert.equal(
      discoveries.filter((item) => item === `${bookingUi} :: iguide-booking-call:${operation}`).length,
      expectedCount,
      `${bookingUi} must contain exactly ${expectedCount} call(s) to ${operation}`,
    );
    assert.equal(
      discoveries.filter((item) => item === `${bookingActions} :: iguide-booking-definition:${operation}`).length,
      1,
      `${bookingActions} must export exactly one ${operation} definition`,
    );
  }
  const missing = discoveries.filter((discovery) => {
    const path = discovery.split(" :: ")[0];
    return !document.includes(path);
  });
  assert.deepEqual(missing, [], `Inventory is missing discovered media sinks:\n${missing.join("\n")}`);
});

test("inventory explicitly names every destructive media-reference writer", () => {
  const document = inventory();
  for (const operation of [
    "deleteDeliverable",
    "saveIGuideId",
    "saveIGuidePhotoDownloads",
    "saveFotelloDeliveryLinks",
    "untrackFotelloEnhance",
    "upsertDeliverables",
  ]) {
    assert.match(document, new RegExp(`\\b${operation}\\b`), `${operation} must be inventoried explicitly`);
  }
  assert.match(document, /app\/api\/autoenhance-test\/enhanced\/\[imageId\]\/route\.ts/);
});

test("media inventory classifies migration and records production preservation rules", () => {
  const document = inventory();

  assert.match(document, /Retain and harden/);
  assert.match(document, /Migrate behind compatibility read/);
  assert.match(document, /Retire only after zero supported use/);
  assert.match(document, /deliverables\.url/);
  assert.match(document, /gallery_image_urls/);
  assert.match(document, /No current customer record, deliverable, file, or route is deleted by Release 0/);
  assert.match(document, /streams the upstream body without an application byte ceiling/i);
  assert.match(document, /arrayBuffer\(\)/);
  assert.match(document, /explicit `organization_id` and `booking_id` predicates/i);
});
