import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('precision presentation is opt-in at the three application route shells', () => {
  for (const route of ['book', 'portal', 'admin']) {
    assert.match(read(`app/${route}/layout.tsx`), /className="[^"]*pixel-app-skin/);
  }
  assert.doesNotMatch(read('app/layout.tsx'), /className="[^"]*pixel-app-skin/);
  assert.match(read('app/layout.tsx'), /import "\.\/precision-skin.css"/);
});

test('nonsemantic panel wrappers opt in without changing control geometry', () => {
  for (const p of ['app/book/_components/BookingTotalBar.tsx', 'app/admin/calendar/CalendarWeekView.tsx', 'app/admin/bookings/[id]/BookingWorkspaceTabs.tsx']) {
    assert.match(read(p), /precision-panel/);
  }
});

test('every skin rule is scoped; no behavior, semantic-color or overflow suppression overrides', () => {
  const file = new URL('../app/precision-skin.css', import.meta.url);
  assert.ok(existsSync(file), 'The application skin must exist');
  assert.match(read('app/precision-skin.css'), /\.pixel-app-skin \[role="dialog"\]/);
  const root = postcss.parse(readFileSync(file, 'utf8'));
  root.walkRules(rule => {
    for (const selector of rule.selectors) assert.ok(selector.includes('.pixel-app-skin'), selector);
    assert.doesNotMatch(rule.selector, /(?:red-|amber-|emerald-|sourceColor|data-kind|text-white)/);
  });
  const shootDisplay = new Map([
    ['.pixel-app-skin .precision-shoot-summary > div:first-child', 'flex'],
    ['.pixel-app-skin .precision-shoot-heading :is(a, button)', 'inline-flex'],
  ]);
  root.walkDecls(decl => {
    // The shoot-only polish may align existing summary/action elements. No
    // visibility suppression or global layout override is allowed.
    if (decl.prop === 'display' && shootDisplay.has(decl.parent.selector)) {
      assert.equal(decl.value, shootDisplay.get(decl.parent.selector));
      return;
    }
    assert.ok(!['display', 'visibility', 'pointer-events', 'position', 'z-index', 'overflow', 'overflow-x', 'overflow-y'].includes(decl.prop), decl.toString());
  });
});
