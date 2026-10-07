import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToPipeableStream } from 'react-dom/server';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { loadSource, resultQuery } from './helpers/source-module.mjs';

const require = createRequire(import.meta.url);
require('tsx/cjs');
const pure = name => name === 'booking/availability' ? loadSource('lib/booking/availability.ts', {
  '@/lib/integrations/google-calendar/client': { getGoogleCalendarClients() { throw Error('No provider I/O'); } },
  '@/lib/organizations/default': {}, '@/lib/supabase/server': { getServiceSupabase() { throw Error('No database I/O'); } },
  './services': require('../lib/booking/services.ts'), '@/lib/booking/timezone': require('../lib/booking/timezone.ts'),
}) : require('../lib/' + name + '.ts');
const Link = ({ children, ...props }) => React.createElement('a', props, children);
const Empty = () => null;
const booking = {
  id: 'sample', lifecycle_version: 7, status: 'confirmed', scheduled_at: '2026-10-07T13:00:00Z',
  scheduled_ends_at: null, services: ['real_estate_photos'], add_ons: [], square_footage: 2000,
  properties: { id: 'sample-property', street_address: '18 Sample Lane', city: 'Hamilton', province: 'ON', postal_code: 'A1A 1A1' },
  profiles: { id: 'sample-realtor', full_name: 'Sample Realtor', email: 'sample@example.com', delivery_cc_emails: [] },
};
const dates = loadSource('lib/booking/calendar-week-range.ts');
test('calendar date windows stay seven local dates through both Toronto DST changes', () => {
  for (const start of ['2026-03-08', '2026-11-01']) {
    const days = Array.from({ length: 7 }, (_, i) => dates.shiftCalendarDate(start, i));
    assert.equal(new Set(days).size, 7);
    assert.ok(days.every(day => dates.calendarWeekStart(day) === start));
    assert.equal(dates.calendarWeekStart(dates.shiftCalendarDate(start, 7)), dates.shiftCalendarDate(start, 7));
  }
  for (const bad of ['2026-02-30', '2026-13-01', '01-01-2026', '2026-1-01', '', '2026-01-01T00:00']) assert.equal(dates.isCalendarDate(bad), false);
  assert.equal(dates.isCalendarDate('2028-02-29'), true);
});

function endpoint({ denied = false, failure = false, throws = false } = {}) {
  const calls = [];
  return { calls, ...loadSource('app/api/admin/calendar/week/route.ts', {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, ...options }) } },
    '@/lib/auth/require-admin': { requireAdmin: async () => { calls.push('auth'); if (denied) throw Error('denied'); } },
    '@/lib/booking/calendar-week-range': dates,
    '@/app/admin/calendar/calendar-data': { loadCalendarWeek: async params => { calls.push(params); if (throws) throw Error('private diagnostic'); return { weekStart: params.week, days: [], items: [], databaseLoadFailed: failure }; } },
  }) };
}
test('calendar API authenticates first, validates one window and never publicly caches notes', async () => {
  const h = endpoint();
  const bad = await h.GET({ nextUrl: new URL('https://fixture/api?week=2026-02-30') });
  assert.equal(bad.status, 400); assert.deepEqual(h.calls, ['auth']);
  const result = await h.GET({ nextUrl: new URL('https://fixture/api?week=2026-10-04&q=' + 'a'.repeat(500)) });
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  assert.equal(h.calls[2].q.length, 300); assert.equal(h.calls[2].week, '2026-10-04');
  const blocked = endpoint({ denied: true });
  await assert.rejects(() => blocked.GET({ nextUrl: new URL('https://fixture/api?week=2026-10-04') }), /denied/);
  assert.deepEqual(blocked.calls, ['auth']);
  for (const config of [{ failure: true }, { throws: true }]) {
    const result = await endpoint(config).GET({ nextUrl: new URL('https://fixture/api?week=2026-10-04') });
    assert.equal(result.status, 503); assert.doesNotMatch(JSON.stringify(result), /private diagnostic/);
  }
});

function weather(credential, fetch) {
  return loadSource('app/admin/today/weather.ts', {
    '@/lib/booking/availability': pure('booking/availability'),
    '@/lib/integrations/credentials': { getCredential: credential },
  }, { fetch, AbortController, setTimeout, clearTimeout }).loadShootWeather;
}
test('weather has an overall deadline even if credential lookup never settles', async () => {
  const start = performance.now();
  const result = await weather(() => new Promise(() => {}), () => { throw Error('must not fetch'); })(booking, 'tenant', 25);
  assert.equal(result, null); assert.ok(performance.now() - start < 500);
});
test('weather aborts stalled providers and returns a stable unavailable state', async () => {
  let signal;
  const result = await weather(async () => 'fixture-key', async (_url, options) => { signal = options.signal; return new Promise(() => {}); })(booking, 'tenant', 25);
  assert.equal(result, null); assert.equal(signal.aborted, true);
  assert.equal(await weather(async () => { throw Error('provider error'); }, () => {})(booking, 'tenant', 25), null);
});
test('weather preserves forecast timezone, cache policy and local-hour selection', async () => {
  const requests = [];
  const load = weather(async () => null, async (url, options) => {
    requests.push({ url: new URL(url), options });
    return { ok: true, json: async () => requests.length === 1 ? { results: [{ latitude: 43.2, longitude: -79.8, name: 'Hamilton', country_code: 'CA', admin1: 'ON' }] } : {
      hourly: { time: ['2026-10-07T08:00', '2026-10-07T09:00'], temperature_2m: [1, 18], cloud_cover: [50, 20], precipitation_probability: [90, 10], weather_code: [1, 2], wind_speed_10m: [1, 9] },
    } };
  });
  const result = await load(booking, 'tenant');
  assert.equal(result.temperatureC, 18); assert.equal(result.windKph, 9);
  assert.equal(requests[1].url.searchParams.get('timezone'), 'America/Toronto');
  assert.equal(requests[0].options.next.revalidate, 86400); assert.equal(requests[1].options.next.revalidate, 900);
});

function detailHarness({ denied = false, missing = false } = {}) {
  const calls = [];
  const db = { from(table) { calls.push(table); return resultQuery({ data: table === 'bookings' ? (missing ? null : booking) : table === 'deliverables' ? [] : null }); } };
  const dependencies = {
    'react/jsx-runtime': jsx, 'next/link': { default: Link }, 'next/navigation': { notFound() { throw Error('not_found'); } },
    '@/lib/auth/require-admin': { requireAdmin: async () => { calls.push('auth'); if (denied) throw Error('denied'); return { organizationId: 'tenant', userId: 'actor' }; } },
    '@/lib/supabase/server': { getServerSupabase: async () => db, getServiceSupabase: () => { calls.push('service'); return db; } },
    '@/lib/booking/internal-shoot-notes-server': { loadBookingInternalNote: async args => { calls.push('private-notes'); assert.equal(args.organizationId, 'tenant'); return { notes: null, revision: 0 }; } },
    '@/lib/booking/catalog': { getFullCatalog: async () => { calls.push('catalog'); return { bundles: [], aLaCarte: [], addons: [] }; } },
    '@/lib/integrations/iguide/portal-client': { hasPortalCredentials: async () => { calls.push('portal'); return true; } },
    '@/lib/integrations/provider-enablement': { isPhotoEditingProviderEnabled: async provider => { calls.push(provider); return true; } },
    '@/lib/integrations/autoenhance/workflow': { listBookingAutoenhanceBatches: async () => { calls.push('batches'); return []; } },
  };
  for (const name of ['booking/booking-status', 'booking/delivery-links', 'booking/media-images', 'realtors/memory', 'booking/services', 'integrations/iguide/photo-downloads']) dependencies['@/lib/' + name] = pure(name);
  for (const name of ['LifecycleNotices', 'BookingActions', 'BookingWorkspaceTabs', 'AutoenhanceSection', 'EditBookingForm', 'IGuideSection', 'InvoiceSection', 'ListingWebsiteSection', 'MediaWorkflow', 'RescheduleBookingForm', 'VideoLinksSection']) dependencies['./' + name] = { default: Empty, DeliveryEmailPanel: Empty, ManualLinksPanel: Empty };
  dependencies['../CancelBookingButton'] = dependencies['../../internal-shoot-notes/InternalShootNotesEditor'] = { default: Empty };
  return { calls, run: tab => loadSource('app/admin/bookings/[id]/page.tsx', dependencies).default({ params: Promise.resolve({ id: 'sample' }), searchParams: Promise.resolve({ tab }) }) };
}
for (const [tab, expected] of [
  ['details', ['catalog', 'private-notes']], ['billing', ['catalog', 'private-notes']],
  ['media', ['iguide_jobs', 'autohdr', 'autoenhance', 'batches', 'portal']],
  ['website', ['listing_websites']], ['delivery', ['service', 'booking_notifications']],
]) test(`booking ${tab} loads only its required optional data`, async () => {
  const h = detailHarness(); await h.run(tab);
  assert.equal(h.calls[0], 'auth');
  assert.deepEqual(h.calls.slice(1).sort(), ['bookings', 'deliverables', ...expected].sort());
});
test('booking tab optimization preserves auth and missing-booking boundary', async () => {
  const h = detailHarness({ denied: true }); await assert.rejects(() => h.run('details'), /denied/); assert.deepEqual(h.calls, ['auth']);
  const missing = detailHarness({ missing: true }); await assert.rejects(() => missing.run('delivery'), /not_found/);
  assert.ok(!missing.calls.includes('service'));
});

test('Today streams useful booking content while weather remains unresolved', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const dependencies = {
    react: React, 'react/jsx-runtime': jsx, 'next/link': { default: Link },
    '@/lib/auth/require-admin': { requireAdmin: async () => ({ organizationId: 'tenant', userId: 'actor' }) },
    '@/lib/supabase/server': { getServerSupabase: async () => ({ from: table => resultQuery({ data: table === 'bookings' ? [booking] : [] }) }) },
    '@/lib/booking/internal-shoot-notes-server': { loadBookingInternalNotes: async () => new Map() },
    './actions': { loadTodayCommandPreferences: async () => ({}) }, './weather': { loadShootWeather: () => waiting },
    '../AdminPageHeading': { default: ({ title }) => React.createElement('h1', null, title) },
    '../internal-shoot-notes/InternalShootNotesEditor': { default: Empty }, './DailyAIBriefPanel': { default: Empty }, './OfflineTodaySnapshot': { default: Empty },
  };
  for (const name of ['booking/booking-status', 'booking/availability', 'booking/services', 'realtors/memory']) dependencies['@/lib/' + name] = pure(name);
  const tree = await loadSource('app/admin/today/page.tsx', dependencies).default();
  let html = '', ready;
  const shell = new Promise(resolve => { ready = resolve; });
  const stream = new PassThrough(); stream.on('data', chunk => { html += chunk; ready(); });
  const ended = new Promise(resolve => stream.on('end', resolve));
  const rendered = renderToPipeableStream(tree, { onShellReady() { rendered.pipe(stream); } });
  await shell;
  assert.match(html, /18 Sample Lane/); assert.match(html, /Loading forecast/); assert.doesNotMatch(html, /18°/);
  release({ temperatureC: 18, weatherCode: 2, windKph: 9, cloudCover: 20, precipitationProbability: 10 });
  await ended; assert.match(html, /18°/);
});
