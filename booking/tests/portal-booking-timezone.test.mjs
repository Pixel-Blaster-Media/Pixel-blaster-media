import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("realtor portal booking times always render in the business timezone", () => {
  for (const path of ["app/portal/page.tsx", "app/portal/[propertyId]/page.tsx"]) {
    const source = read(path);
    assert.match(source, /BUSINESS_TZ/);
    assert.match(source, /timeZone:\s*BUSINESS_TZ/);
  }
});
