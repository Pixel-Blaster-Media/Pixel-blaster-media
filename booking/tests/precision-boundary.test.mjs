import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
const base = '3039dbc357f78b3c9a97d5dbe1d5c0c54785f85f';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const changes = {
  'app/admin/bookings/[id]/BookingWorkspaceTabs.tsx': [['precision-panel ', ''], ['precision-shoot-tabs ', '']],
  'app/admin/bookings/[id]/MediaWorkflow.tsx': [['precision-shoot-planned ', '']],
  'app/admin/calendar/CalendarWeekView.tsx': [
    ['precision-panel ', ''],
    ['precision-calendar-event ', ''],
    ['precision-calendar-block ', ''],
    ['precision-calendar-drag ', ''],
    ['    case "confirmed":\n      return "precision-calendar-confirmed border-[#8ba98f] bg-[#dce9dc] text-realtor-text hover:bg-[#d2e1d2]";\n', ''],
  ],
  'app/admin/bookings/[id]/page.tsx': [
    ['precision-job-status ', ''],
    ['precision-shoot-workspace ', ''],
    ['precision-shoot-heading ', ''],
    ['precision-shoot-summary ', ''],
    ['precision-shoot-panel ', ''],
    ['Review delivery', 'Send delivery'],
  ],
  'app/admin/bookings/[id]/ListingWebsiteSection.tsx': [['precision-template-caption ', '']],
  'app/book/_components/BookingTotalBar.tsx': [['precision-panel ', '']],
  'app/book/layout.tsx': [['pixel-app-skin ', '']],
  'app/layout.tsx': [['import "./precision-skin.css";\n', ''], ['        data-pixel-default-palette={!user || user.organizationId === DEFAULT_ORGANIZATION_ID ? true : undefined}\n', '']],
  'app/admin/layout.tsx': [['pixel-app-skin ', ''], ['      data-pixel-default-palette={admin.organizationId === DEFAULT_ORGANIZATION_ID ? true : undefined}\n', '']],
  'app/portal/layout.tsx': [['pixel-app-skin ', ''], ['      data-pixel-default-palette={user.organizationId === DEFAULT_ORGANIZATION_ID ? true : undefined}\n', '']],
  'app/book/_components/BookingBrandHeader.tsx': [[' data-pixel-default-palette={organization.id === DEFAULT_ORGANIZATION_ID ? true : undefined}', '']],
};
const identityImport = 'import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";\n';
for (const file of ['app/layout.tsx', 'app/admin/layout.tsx', 'app/portal/layout.tsx', 'app/book/_components/BookingBrandHeader.tsx']) changes[file].push([identityImport, '']);
test('all production TSX changes are exact presentation additions only', () => {
  const cwd = new URL('..', import.meta.url);
  const files = execFileSync('git', ['diff', '--name-only', base, '--', '*.tsx'], { cwd, encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(files.map(f => f.replace(/^booking\//, '')).sort(), Object.keys(changes).sort());
  for (const [file, replacements] of Object.entries(changes)) {
    let candidate = read(file);
    for (const [addition, removal] of replacements) {
      assert.ok(candidate.includes(addition), `Exact allowed addition missing: ${file}: ${addition}`);
      candidate = candidate.replaceAll(addition, removal);
    }
    assert.equal(candidate, execFileSync('git', ['show', `${base}:booking/${file}`], { cwd, encoding: 'utf8' }), file);
  }
});
test('default palette identity never falls back from failed brand loading', () => {
  for (const file of ['app/layout.tsx', 'app/admin/layout.tsx', 'app/portal/layout.tsx', 'app/book/_components/BookingBrandHeader.tsx']) {
    const markers = [...read(file).matchAll(/data-pixel-default-palette=\{([^}]+)\}/g)];
    assert.equal(markers.length, 1, file);
    assert.match(markers[0][1], /=== DEFAULT_ORGANIZATION_ID \? true : undefined$/);
    assert.doesNotMatch(markers[0][1], /brand|primaryColor|name|slug/);
  }
});
