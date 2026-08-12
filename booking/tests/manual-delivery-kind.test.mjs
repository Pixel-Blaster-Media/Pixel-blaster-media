import assert from "node:assert/strict";
import test from "node:test";

import { validateManualDeliveryKind } from "../lib/booking/manual-delivery-kind.ts";

test("photo galleries accept only explicit MLS and high-resolution slots", () => {
  assert.equal(validateManualDeliveryKind("photo_gallery", "mls"), null);
  assert.equal(validateManualDeliveryKind("photo_gallery", "high_res"), null);
  assert.equal(validateManualDeliveryKind("photo_gallery", null), null);
  assert.match(validateManualDeliveryKind("photo_gallery", "streaming") ?? "", /supported photo delivery slot/i);
});

test("existing video links retain download and streaming delivery kinds", () => {
  assert.equal(validateManualDeliveryKind("video", "download"), null);
  assert.equal(validateManualDeliveryKind("video", "streaming"), null);
  assert.equal(validateManualDeliveryKind("video", null), null);
});

test("non-photo deliverables cannot claim photo slots", () => {
  assert.match(validateManualDeliveryKind("video", "mls") ?? "", /photo delivery slots require a photo gallery/i);
  assert.match(validateManualDeliveryKind("floor_plan", "high_res") ?? "", /photo delivery slots require a photo gallery/i);
});

test("unknown delivery kinds fail closed for every type", () => {
  assert.match(validateManualDeliveryKind("video", "unknown") ?? "", /unsupported delivery kind/i);
  assert.match(validateManualDeliveryKind("tour", "download") ?? "", /unsupported delivery kind/i);
});
