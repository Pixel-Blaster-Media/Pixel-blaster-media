import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadSource, resultQuery } from './helpers/source-module.mjs';
import { noticeHarness, policy } from './helpers/customer-booking-notice.mjs';

for (const now of ['2026-10-19T14:00:00Z', '2026-03-07T15:00:00Z', '2026-10-31T14:00:00Z', '2026-12-31T23:30:00Z']) {
  test(`elapsed 24-hour boundary inclusive, +/- 1 ms at ${now}`, () => {
    const time = new Date(now);
    for (const delta of [-1, 0, 1]) assert.equal(
      policy.meetsCustomerBookingNotice(new Date(time.getTime() + 86_400_000 + delta), time), delta >= 0,
    );
    assert.equal(policy.meetsCustomerBookingNotice(new Date('invalid'), time), false);
  });
}

const range = { from: new Date('2026-10-19T12:00:00Z'), to: new Date('2026-10-22T00:00:00Z'), durationMinutes: 60, organizationId: 'org-a' };
test('same-day and next-day slots inside the rolling window are excluded, including a forged earlier range', async () => {
  const h = noticeHarness();
  const slots = await h.availability.listAvailableSlots(range);
  assert.equal(slots[0].start, '2026-10-20T14:00:00.000Z');
  assert.ok(slots.every(slot => new Date(slot.start).getTime() >= new Date('2026-10-20T14:00:00Z').getTime()));
  assert.ok(h.calls.some(call => call[0] === 'eq' && call[1] === 'id' && call[2] === 'org-a'));
});
test('stale availability is rechecked at submission, including a one-millisecond boundary crossing', async () => {
  const h = noticeHarness();
  const start = new Date('2026-10-20T14:00:00Z');
  assert.equal(await h.availability.isSlotAvailable(start, 60, { organizationId: 'org-a' }), true);
  h.advance(1);
  assert.equal(await h.availability.isSlotAvailable(start, 60, { organizationId: 'org-a' }), false);
  assert.equal(await h.settings.customerBookingNoticeError(start, 'org-a'), policy.CUSTOMER_BOOKING_NOTICE_MESSAGE);
});
test('disabled allows same-day slots; a newly enabled setting is read on the next request', async () => {
  const h = noticeHarness({ enabled: false });
  const start = new Date('2026-10-19T15:00:00Z');
  assert.equal(await h.availability.isSlotAvailable(start, 60), true);
  h.state.enabled = true;
  assert.equal(await h.availability.isSlotAvailable(start, 60), false);
});
test('a slow calendar read cannot return a slot that expired while loading', async () => {
  const h = noticeHarness();
  h.state.onCalendarRead = () => h.advance(1);
  const slots = await h.availability.listAvailableSlots(range);
  assert.equal(slots[0].start, '2026-10-20T14:30:00.000Z');
});
for (const [now, first, hour] of [
  ['2026-03-07T15:00:00Z', '2026-03-08T15:00:00.000Z', '11'],
  ['2026-10-31T14:00:00Z', '2026-11-01T14:00:00.000Z', '09'],
]) test(`availability uses elapsed hours through Toronto DST at ${now}`, async () => {
  const h = noticeHarness({ now });
  const slots = await h.availability.listAvailableSlots({ from: new Date(now), to: new Date(new Date(now).getTime() + 72 * 3_600_000), durationMinutes: 60 });
  assert.equal(slots[0].start, first);
  assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', hourCycle: 'h23' }).format(new Date(first)), hour);
});
for (const enabled of [undefined, null, 'true']) test(`missing/malformed notice setting (${enabled}) fails closed`, async () => {
  const h = noticeHarness(); h.state.enabled = enabled;
  await assert.rejects(h.availability.listAvailableSlots(range), /temporarily unavailable/);
});
test('settings outage cannot silently disable the rule', async () => {
  const h = noticeHarness({ failure: true });
  await assert.rejects(h.availability.listAvailableSlots(range), /temporarily unavailable/);
  assert.equal(await h.settings.customerBookingNoticeError(range.from, 'org-a'), policy.BOOKING_AVAILABILITY_ERROR);
});

test('admin checkbox saves on and off for only the authenticated organization, and reloads persisted state', async () => {
  let stored = false;
  const writes = [], invalidations = [];
  const actions = loadSource('app/admin/settings/availability/actions.ts', {
    '@/lib/auth/require-admin': { requireAdmin: async () => ({ organizationId: 'org-a' }) },
    '@/lib/booking/availability': {},
    'next/cache': { revalidatePath: path => invalidations.push(path) },
    '@/lib/supabase/server': { getServiceSupabase: () => ({ from(table) {
      assert.equal(table, 'organizations');
      return { update(update) { stored = update.require_24_hour_notice; writes.push(update); return resultQuery({ data: { id: 'org-a' }, error: null }, writes); } };
    } }) },
  });
  for (const enabled of [true, false]) {
    const form = new FormData();
    form.set('organization_id', 'forged-org');
    if (enabled) form.set('require_24_hour_notice', 'on');
    assert.equal((await actions.saveBookingNotice(form)).ok, true);
    const reader = loadSource('lib/booking/notice-settings.ts', { './notice-policy': policy,
      '@/lib/supabase/server': { getServiceSupabase: () => ({ from: () => resultQuery({ data: { require_24_hour_notice: stored }, error: null }) }) },
    });
    assert.equal(await reader.requiresCustomerBookingNotice('org-a'), enabled);
  }
  assert.ok(writes.some(call => Array.isArray(call) && call[0] === 'eq' && call[1] === 'id' && call[2] === 'org-a'));
  assert.ok(!JSON.stringify(writes).includes('forged-org'));
  assert.ok(invalidations.includes('/book/schedule'));
});
test('unauthorized setting writes stop before database access', async () => {
  const actions = loadSource('app/admin/settings/availability/actions.ts', {
    '@/lib/auth/require-admin': { requireAdmin: async () => { throw Error('Not an admin'); } },
    '@/lib/booking/availability': {}, 'next/cache': {},
    '@/lib/supabase/server': { getServiceSupabase: () => { throw Error('Unexpected database access'); } },
  });
  await assert.rejects(actions.saveBookingNotice(new FormData()), /Not an admin/);
});
test('settings never report success for a missing row or failed persistence', async () => {
  for (const result of [{ data: null, error: null }, { data: null, error: { code: 'offline' } }]) {
    const actions = loadSource('app/admin/settings/availability/actions.ts', {
      '@/lib/auth/require-admin': { requireAdmin: async () => ({ organizationId: 'org-a' }) },
      '@/lib/booking/availability': {}, 'next/cache': { revalidatePath: () => assert.fail('Must not invalidate failed saves') },
      '@/lib/supabase/server': { getServiceSupabase: () => ({ from: () => resultQuery(result) }) },
    });
    assert.equal((await actions.saveBookingNotice(new FormData())).ok, false);
  }
});
test('checkbox renders persisted checked state, customer scope and existing admin behavior', () => {
  const Editor = loadSource('app/admin/settings/availability/BookingNoticeEditor.tsx', {
    react: React, 'react/jsx-runtime': jsxRuntime, './actions': {},
  }).default;
  for (const enabled of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(Editor, { enabled }));
    assert.equal(/checked=""/.test(html), enabled);
    assert.match(html, /Require at least 24 hours/);
    assert.match(html, /Existing appointments stay booked/);
    assert.match(html, /admin calendar/);
  }
});

test('checkbox submits its current value without the automatic form reset, and retains errors on failure', async () => {
  const { create, act } = await import('react-test-renderer');
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let persisted = false, fail = false;
  const Editor = loadSource('app/admin/settings/availability/BookingNoticeEditor.tsx', {
    react: React, 'react/jsx-runtime': jsxRuntime,
    './actions': { saveBookingNotice: async form => {
      if (fail) return { ok: false, error: 'Fixture save failed' };
      persisted = form.get('require_24_hour_notice') === 'on'; return { ok: true };
    } },
  }, { FormData: class { constructor(element) { this.checked = element.checked; } get() { return this.checked ? 'on' : null; } } }).default;
  let view;
  await act(async () => { view = create(React.createElement(Editor, { enabled: false })); });
  for (const checked of [true, false]) {
    await act(async () => view.root.findByType('input').props.onChange({ currentTarget: { checked } }));
    let prevented = false;
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() { prevented = true; }, currentTarget: { checked } }));
    assert.equal(prevented, true);
    assert.equal(view.root.findByType('form').props.action, undefined);
    assert.equal(persisted, checked);
    assert.equal(view.root.findByType('input').props.checked, checked);
    assert.equal(view.root.findByProps({ role: 'status' }).children[0], 'Booking notice saved.');
  }
  fail = true;
  await act(async () => view.root.findByType('input').props.onChange({ currentTarget: { checked: true } }));
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {}, currentTarget: { checked: true } }));
  assert.equal(persisted, false);
  assert.equal(view.root.findAllByProps({ role: 'status' }).length, 0);
  assert.equal(view.root.findByProps({ role: 'alert' }).children[0], 'Fixture save failed');
  await act(async () => view.unmount());
});

test('customer schedule explains enabled notice and removes a stale selected slot from Continue', async () => {
  const state = { organizationSlug: 'test', services: ['photo'], addOns: [], includeBasement: false, slot: '2026-10-20T14:00:00.000Z' };
  const item = { slug: 'photo', duration_minutes: 60, price_cents: 10000 };
  for (const offered of [false, true]) {
    const Schedule = loadSource('app/book/schedule/page.tsx', {
      'react/jsx-runtime': jsxRuntime,
      '@/lib/booking/quote': loadSource('lib/booking/quote.ts'),
      '@/lib/booking/wizard-draft': { readPublicWizardState: () => state, loadPrivateWizardState: async () => state },
      'next/navigation': { notFound() { assert.fail(); }, redirect() { assert.fail(); } },
      '@/lib/booking/catalog': { getActiveCatalog: async () => ({ bundles: [item], aLaCarte: [], addons: [] }) },
      '@/lib/booking/slot-display': { loadSlotsForNextDays: async () => [{ slots: offered ? [{ start: state.slot }] : [] }] },
      '@/lib/booking/notice-settings': { requiresCustomerBookingNotice: async () => true },
      '@/lib/booking/wizard-state': { stepCompleteness: () => ({ step1: true, step2: true }), serializeWizardState: () => new URLSearchParams('fixture=true') },
      '@/lib/organizations/public-booking': { resolvePublicBookingOrganization: async () => ({ id: 'org-a', slug: 'test' }) },
      '../_components/BookingBrandHeader': { default: () => null, BookingBrandFrame: ({ children }) => React.createElement('main', null, children) },
      '../_components/Stepper': { default: () => null },
      './CalendarPicker': { default: () => null },
      '../_components/BookingTotalBar': { default: ({ href, disabled, ctaLabel }) => href ? React.createElement('a', { href }, ctaLabel) : React.createElement('button', { disabled }, ctaLabel) },
    }).default;
    const html = renderToStaticMarkup(await Schedule({ searchParams: Promise.resolve({}) }));
    assert.match(html, /Please book at least 24 hours ahead/);
    assert.match(html, /Eastern Time/);
    assert.equal(/>Continue<\/a>/.test(html), offered);
    assert.equal(/disabled=""/.test(html), !offered);
  }
});
