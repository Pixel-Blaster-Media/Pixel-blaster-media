import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

async function source(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("Site Plan is seeded at $100 and 20 minutes with an iGUIDE-only database rule", async () => {
  const migrations = await fs.readdir(path.join(root, "supabase/migrations"));
  const name = migrations.find((file) => file.endsWith("_site_plan_addon.sql"));
  assert.ok(name, "Missing Site Plan add-on migration");

  const sql = await source(`supabase/migrations/${name}`);
  assert.match(sql, /add column if not exists require_has_iguide boolean not null default false/i);
  assert.match(sql, /'site_plan'[\s\S]*?'Site Plan'/i);
  assert.match(sql, /'Site Plan'[\s\S]*?20[\s\S]*?10000/i);
  assert.match(sql, /require_has_iguide[\s\S]*?true/i);
  assert.match(sql, /has_iguide[\s\S]*?bool_or\(catalog\.is_iguide\)/i);
  assert.match(sql, /addon\.require_has_iguide and not has_iguide/i);
  assert.match(sql, /Selected add-on is not eligible for these services/i);
  assert.match(sql, /grant execute on function public\.create_public_booking_with_jobs/i);
});

test("iGUIDE-only eligibility crosses database types, public DTOs, admin catalog, and company cloning", async () => {
  const [types, dto, companySetup, adminActions, newItemForm, priceRow, setup] = await Promise.all([
    source("lib/supabase/database.types.ts"),
    source("lib/booking/catalog-dto.ts"),
    source("lib/platform/company-setup.ts"),
    source("app/admin/settings/pricing/actions.ts"),
    source("app/admin/settings/pricing/NewItemForm.tsx"),
    source("app/admin/settings/pricing/PriceRow.tsx"),
    source("supabase/setup.sql"),
  ]);

  assert.match(types, /require_has_iguide[?]?: boolean/);
  assert.match(dto, /require_has_iguide: boolean/);
  assert.match(companySetup, /require_has_iguide:\s*item\.require_has_iguide/);
  assert.match(adminActions, /require_has_iguide:/);
  assert.match(newItemForm, /name="require_has_iguide"/);
  assert.match(priceRow, /name="require_has_iguide"/);
  assert.match(setup, /'site_plan'[\s\S]*?'Site Plan'/i);
});
