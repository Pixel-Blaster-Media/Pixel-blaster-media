import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path) {
  const filename = new URL("../" + path + ".ts", import.meta.url);
  const source = readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInThisContext("(function(exports, require) {" + outputText + "\n})",
    { filename: filename.pathname })(exports, (specifier) => {
    assert.ok(specifier.startsWith("@/"), "Unexpected dependency: " + specifier);
    return load(specifier.slice(2));
  });
  return exports;
}
const { buildDeliveryLinks } = load("lib/booking/delivery-links");
const appUrl = "https://studio.example.test";
const tour = "https://youriguide.com/example_listing";
const mls = tour + "/doc/gallery-low-res.zip?authtoken=fixture%2Fmls&download=1";
const high = tour + "/doc/gallery.zip?authtoken=fixture%2Bhigh";
const ready = [
  { id: "tour", type: "virtual_tour", source: "iguide", url: tour, metadata: null },
  { id: "photos", type: "photo_gallery", source: "iguide", url: mls,
    metadata: { mls_photo_zip_url: mls, high_res_photo_zip_url: high } },
];
const photos = (links) => links.filter(({ category }) => category === "photos");

test("recipient email uses both provider ZIP links without changing their signed query", () => {
  const links = buildDeliveryLinks(ready, appUrl, { iGuidePhotoLinks: "provider" });
  assert.deepEqual(photos(links).map(({ url, slot }) => [url, slot]),
    [[mls, "photos_mls"], [high, "photos_full_res"]]);
  assert.deepEqual(links.filter(({ category }) => category !== "photos"),
    buildDeliveryLinks(ready, appUrl).filter(({ category }) => category !== "photos"));
});

test("other callers retain the login-protected photo proxy", () => {
  assert.deepEqual(photos(buildDeliveryLinks(ready, appUrl)).map(({ url }) => url),
    [mls, high].map((url) => appUrl + "/api/iguide/download?url=" + encodeURIComponent(url)));
});

test("recipient email omits untrusted or invalid ZIPs", () => {
  const inputs = [
    "https://example.test/doc/gallery-low-res.zip",
    "http://youriguide.com/example_listing/doc/gallery-low-res.zip",
    "https://user:pass@youriguide.com/example_listing/doc/gallery-low-res.zip",
    "https://youriguide.com:8443/example_listing/doc/gallery-low-res.zip",
    "https://youriguide.com/example_listing/doc/other.zip",
  ];
  for (const url of inputs) {
    const links = buildDeliveryLinks([ready[0], { ...ready[1], url, metadata: null }],
      appUrl, { iGuidePhotoLinks: "provider" });
    assert.deepEqual(photos(links), []);
  }
});
