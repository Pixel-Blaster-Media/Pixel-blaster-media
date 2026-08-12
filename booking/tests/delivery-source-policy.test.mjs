import assert from "node:assert/strict";
import test from "node:test";

import { selectDeliverySources } from "../lib/booking/delivery-source-policy.ts";

const iguideMls = {
  category: "photos",
  label: "MLS / low-res photos download",
  url: "/api/iguide/download?url=mls",
  source: "iguide",
  slot: "photos_mls",
};
const iguideHigh = {
  category: "photos",
  label: "High-res photos download",
  url: "/api/iguide/download?url=high",
  source: "iguide",
  slot: "photos_full_res",
};
const pixelMls = {
  category: "photos",
  label: "MLS photos download",
  url: "/api/media/download/pixel-mls",
  source: "pixel_release",
  slot: "photos_mls",
};
const pixelHigh = {
  category: "photos",
  label: "Full-resolution photos download",
  url: "/api/media/download/pixel-high",
  source: "pixel_release",
  slot: "photos_full_res",
};
const manualMls = {
  category: "photos",
  label: "Manual MLS photos",
  url: "https://example.com/manual.zip",
  source: "manual",
  slot: "photos_mls",
};
const tour = {
  category: "tour",
  label: "iGUIDE branded tour",
  url: "https://youriguide.com/example",
  source: "iguide",
};

test("valid iGUIDE photo slots remain authoritative over Pixel and manual candidates", () => {
  const selected = selectDeliverySources(
    [pixelMls, manualMls, iguideMls, tour],
    { pixelFallbackEnabled: true },
  );
  assert.deepEqual(selected, [iguideMls, tour]);
});

test("Pixel fills only the missing iGUIDE photo slot", () => {
  const selected = selectDeliverySources(
    [iguideHigh, pixelMls, pixelHigh, tour],
    { pixelFallbackEnabled: true, pixelPackageSetComplete: true },
  );
  assert.deepEqual(selected, [pixelMls, iguideHigh, tour]);
});

test("Pixel remains unavailable unless package completeness is explicitly true", () => {
  assert.deepEqual(
    selectDeliverySources([pixelMls, pixelHigh, manualMls, tour], {
      pixelFallbackEnabled: true,
    }),
    [manualMls, tour],
  );
});

test("manual links remain the final fallback when Pixel is unavailable", () => {
  assert.deepEqual(
    selectDeliverySources([manualMls, pixelMls], {
      pixelFallbackEnabled: false,
    }),
    [manualMls],
  );
});

test("incomplete Pixel package sets are ignored atomically", () => {
  const selected = selectDeliverySources([pixelMls, manualMls], {
    pixelFallbackEnabled: true,
    pixelPackageSetComplete: false,
  });
  assert.deepEqual(selected, [manualMls]);
});

test("non-photo delivery links preserve their original order", () => {
  const video = {
    category: "video",
    label: "Video download",
    url: "https://example.com/video.mp4",
    source: "manual",
  };
  assert.deepEqual(
    selectDeliverySources([tour, video], { pixelFallbackEnabled: true }),
    [tour, video],
  );
});
