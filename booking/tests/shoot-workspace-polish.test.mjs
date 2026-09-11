import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Frozen fresh origin/main af534fb: this polish may add presentation markers
// and clarify the navigation label, but must not change a workflow expression.
// Intentional future functional changes should update/retire this boundary test.
const baseline = {
  "page.tsx": "cc773dc9965478c49a3194899aae051a42cdaf672e1a3627723b1117fab092b6",
  "BookingWorkspaceTabs.tsx": "3af90382c42f27c3a4114ff5d987f5053d70452405522cba700ca1ad406ec349",
  "MediaWorkflow.tsx": "a36652aa011a0581f05b15fc027ccd8dcf146ba3048139a9d18d85b94e3db74c",
};
const markers = {
  "page.tsx": ["workspace", "heading", "summary", "panel"],
  "BookingWorkspaceTabs.tsx": ["tabs"],
  "MediaWorkflow.tsx": ["planned"],
};
for (const [file, hash] of Object.entries(baseline)) {
  test(`shoot polish preserves exact ${file} workflow bytes`, () => {
    let source = readFileSync(new URL(`../app/admin/bookings/[id]/${file}`, import.meta.url), "utf8");
    for (const marker of markers[file]) {
      const token = `precision-shoot-${marker} `;
      assert.equal(source.split(token).length - 1, 1, `one ${token} marker`);
      source = source.replace(token, "");
    }
    if (file === "page.tsx") {
      assert.equal(source.split("Review delivery").length - 1, 1);
      source = source.replace("Review delivery", "Send delivery");
    }
    assert.equal(createHash("sha256").update(source).digest("hex"), hash);
  });
}

test("shoot presentation remains scoped and uses active tenant tokens", () => {
  const css = readFileSync(new URL("../app/precision-skin.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf("/* Shoot workspace:"), css.indexOf("/* Gently soften"));
  assert.ok(block.includes(".pixel-app-skin .precision-shoot-heading"));
  assert.ok(block.includes("grid-template-columns: repeat(4, minmax(0, 1fr))"));
  assert.ok(block.includes("min-height: 44px"));
  assert.ok(!/#[0-9a-f]{3,8}\b|!important|display:\s*none|visibility:\s*hidden|overflow:\s*hidden/i.test(block));
});
