import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const originalError = console.error;
console.error = (...args) => { if (!String(args[0]).startsWith('react-test-renderer is deprecated')) originalError(...args); };
after(() => { console.error = originalError; });
const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
test('calendar page selects and projects the loaded lifecycle version', () => {
  const source = read('app/admin/calendar/page.tsx');
  assert.match(source, /"id, lifecycle_version, status, scheduled_at/);
  assert.match(source, /bookingDetails: \{\s*lifecycleVersion: booking.lifecycle_version,/);
});
function load(source, mocks = {}, globals = {}) {
  const context = { exports: {}, FormData, console, crypto: globalThis.crypto, ...globals, require: name => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('@/') || name === './actions') throw Error('Unmocked import ' + name);
    return require(name);
  } };
  vm.runInNewContext(compile(source), context);
  return context.exports;
}
const catalog = ['old', 'new', 'other'].map(id => ({ id, slug: id, kind: 'bundle', name: id, active: true, durationMinutes: 60, priceCents: 100, description: '' }));
function actions() {
  const booking = { id: 'booking', owner_id: 'owner', lifecycle_version: 7, services: ['old'], add_ons: [], scheduled_at: '2030-01-01T15:00:00Z', scheduled_ends_at: '2030-01-01T16:00:00Z', properties: { street_address: 'Test' }, profiles: { full_name: 'Realtor', phone: null, brokerage: null } };
  const calls = [], requests = new Map(); let effects = 0;
  const query = { select() { return this; }, eq() { return this; }, async single() { return { data: { ...booking } }; }, async insert() {} };
  const source = read('app/admin/bookings/[id]/actions.ts');
  const ast = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.Latest, true);
  const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && ['updateBookingServicesFromCalendar', 'updateBookingDetails'].includes(n.name?.text));
  const exports = load(functions.map(n => n.getText(ast)).join('\n'), {}, {
    requireAdminForBooking: async () => ({ organizationId: 'tenant', userId: 'actor' }),
    str: (f, k) => String(f.get(k) ?? '').trim(), parseOptionalInt: () => null,
    businessDateTimeLocalToUtc: value => new Date(value), totalDurationMinutes: () => 60,
    getFullCatalog: async () => ({}), catalogRows: () => catalog, validateCart: () => null,
    computeCartTotals: () => ({ totalDurationMinutes: 60 }), revalidatePath() {}, combineActionWarnings: () => undefined,
    syncGoogleCalendarEventBestEffort: async () => { effects++; return true; },
    getServiceSupabase: () => ({ from: () => query, rpc: async (name, input) => {
      calls.push(input);
      const fingerprint = JSON.stringify(input);
      if (requests.has(input.p_request_id)) return requests.get(input.p_request_id) === fingerprint ? { data: { replayed: true } } : { error: { code: 'PB003' } };
      if (input.p_expected_version !== booking.lifecycle_version) return { error: { code: 'PB004' } };
      requests.set(input.p_request_id, fingerprint); booking.lifecycle_version++; booking.services = [...input.p_input.catalog_item_ids];
      return { data: { replayed: false, lifecycle_version: booking.lifecycle_version } };
    } }),
  });
  return { ...exports, booking, calls, effects: () => effects };
}
function quickView(action) {
  return load(read('app/admin/calendar/CalendarWeekView.tsx') + '\nexport { CalendarQuickView };', {
    'next/link': ({ children }) => React.createElement('a', null, children),
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    '@/app/_components/AddressAutocomplete': () => null,
    '@/app/admin/bookings/[id]/actions': { updateBookingServicesFromCalendar: action },
    '@/lib/booking/catalog-rules': { isAddonEligible: () => true },
    '@/app/admin/settings/availability/actions': {}, './actions': {},
  }, { window: { addEventListener() {}, removeEventListener() {} } }).CalendarQuickView;
}
function fullView(action) {
  return load(read('app/admin/bookings/[id]/EditBookingForm.tsx'), {
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    '@/app/_components/AddressAutocomplete': () => null,
    './actions': { updateBookingDetails: action },
  }).default;
}
function editForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries({ street_address: 'Test', contact_name: 'Realtor', catalog_item_id: 'new', lifecycle_version: '7', admin_request_id: '00000000-0000-4000-8000-000000000001' })) form.set(key, value);
  return form;
}
for (const name of ['updateBookingDetails', 'updateBookingServicesFromCalendar']) {
  test(name + ' rejects absent, malformed, ambiguous CAS tokens before RPC', async () => {
    for (const [key, value] of [
      ['admin_request_id', null], ['admin_request_id', ''], ['admin_request_id', 'not-a-uuid'], ['admin_request_id', ' 00000000-0000-4000-8000-000000000001'],
      ...[null, '', '0', '-1', '1.5', '7e0', ' 7', '7 ', 'Infinity', '9007199254740992', '01'].map(value => ['lifecycle_version', value]),
      ['admin_request_id', 'duplicate'], ['lifecycle_version', 'duplicate'],
    ]) {
      const h = actions(), form = editForm();
      if (value === 'duplicate') form.append(key, form.get(key));
      else if (value === null) form.delete(key);
      else form.set(key, value);
      assert.equal((await h[name]('booking', form)).ok, false, `${key}=${value}`);
      assert.equal(h.calls.length, 0, `${key}=${value} reached RPC`);
    }
  });
}
test('full editor can begin a second edit from its own acknowledged commit', async () => {
  const h = actions(), View = fullView(h.updateBookingDetails);
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(View, { bookingId: 'booking', initial: { lifecycleVersion: 7, selectedCatalogItemIds: ['old'] }, catalogItems: catalog })); });
  try {
    await act(async () => renderer.root.findByType('form').props.action(editForm()));
    const next = editForm(); next.set('catalog_item_id', 'other');
    await act(async () => renderer.root.findByType('form').props.action(next));
    assert.deepEqual(h.booking.services, ['other']);
    assert.notEqual(h.calls[0].p_request_id, h.calls[1].p_request_id);
  } finally { await act(async () => renderer.unmount()); }
});
test('full editor submits its draft version even when newer props arrive', async () => {
  const h = actions(), View = fullView(h.updateBookingDetails);
  const initial = { lifecycleVersion: 7, selectedCatalogItemIds: ['old'], streetAddress: 'Test', contactName: 'Realtor' };
  let renderer;
  const props = { bookingId: 'booking', initial, catalogItems: catalog };
  await act(async () => { renderer = TestRenderer.create(React.createElement(View, props)); });
  try {
    h.booking.lifecycle_version = 8;
    await act(async () => renderer.update(React.createElement(View, { ...props, initial: { ...initial, lifecycleVersion: 8 } })));
    await act(async () => renderer.root.findByType('form').props.action(editForm()));
    assert.equal(h.calls[0].p_expected_version, 7);
    assert.deepEqual(h.booking.services, ['old']);
    assert.match(JSON.stringify(renderer.toJSON()), /Booking changed/);
    await act(async () => renderer.root.findByType('form').props.action(editForm()));
    assert.equal(h.calls[0].p_request_id, h.calls[1].p_request_id);
  } finally { await act(async () => renderer.unmount()); }
});
const item = { id: 'booking', kind: 'booking', title: 'Test', subtitle: '', startsAt: '2030-01-01T15:00:00Z', endsAt: '2030-01-01T16:00:00Z', href: '/admin/bookings/booking', bookingDetails: { lifecycleVersion: 7, selectedCatalogItemIds: ['old'], services: ['old'], addOns: [], fullAddress: 'Test', realtorName: 'Realtor', realtorEmail: '', realtorNotificationsSuppressed: true } };
function button(root, text) {
  const textOf = n => typeof n === 'string' ? n : n.children.map(textOf).join('');
  const result = root.findAllByType('button').find(n => textOf(n).startsWith(text));
  assert.ok(result, 'Missing button: ' + text); return result;
}
async function editor(View) {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(View, { item: structuredClone(item), calendarItems: [], catalogItems: catalog, onClose() {}, onChanged() {} })); });
  return renderer;
}
test('actual quick editors reject stale replacement and identical submission replays without effects', async () => {
  const h = actions(), View = quickView(h.updateBookingServicesFromCalendar);
  const a = await editor(View), b = await editor(View);
  try {
    await act(async () => a.root.findAllByType('input').filter(n => n.props.type === 'checkbox')[1].props.onChange());
    await act(async () => b.root.findAllByType('input').filter(n => n.props.type === 'checkbox')[2].props.onChange());
    await act(async () => button(a.root, 'Save package').props.onClick());
    assert.deepEqual(h.booking.services, ['new']);
    await act(async () => button(a.root, 'Save package').props.onClick());
    assert.equal(h.effects(), 1, 'identical replay must not sync again');
    await act(async () => button(b.root, 'Save package').props.onClick());
    assert.deepEqual(h.booking.services, ['new'], 'stale editor must not replace committed package');
    assert.equal(h.calls[2].p_expected_version, 7);
    assert.match(JSON.stringify(b.toJSON()), /Booking changed/);
    assert.equal(h.calls[0].p_request_id, h.calls[1].p_request_id);
    assert.notEqual(h.calls[0].p_request_id, h.calls[2].p_request_id);
  } finally { await act(async () => { a.unmount(); b.unmount(); }); }
});
