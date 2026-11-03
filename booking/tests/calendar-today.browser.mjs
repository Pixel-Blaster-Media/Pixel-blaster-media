// The real calendar and styles, with read-only in-memory weeks and no backend.
// node tests/calendar-today.browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadSource } from './helpers/source-module.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(process.env.CALENDAR_SOURCE || path.join(import.meta.dirname, '..'));
const evidence = process.env.CALENDAR_EVIDENCE;
if (evidence) fs.mkdirSync(evidence, { recursive: true });
require('tsx/cjs');
const config = require(path.join(root, 'tailwind.config.ts')).default;
config.content = [root + '/app/**/*.{ts,tsx}'];
const css = (await require('postcss')([require('tailwindcss')(config), require('autoprefixer')]).process(
  ['globals.css', 'precision-skin.css', 'admin/studio-workspace.css'].map(file => fs.readFileSync(path.join(root, 'app', file), 'utf8')).join('\n'),
  { from: root + '/app/globals.css' },
)).css;
const denied = () => { throw Error('No server I/O in this fixture'); };
const { CalendarSidebar } = loadSource(path.relative(path.join(import.meta.dirname, '..'), path.join(root, 'app/admin/calendar/calendar-data.tsx')), {
  'react/jsx-runtime': jsx,
  'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
  '@/lib/auth/require-admin': { requireAdmin: denied },
  '@/lib/booking/booking-status': {},
  '@/lib/booking/availability': { BUSINESS_TZ: 'America/Toronto' },
  '@/lib/booking/catalog': { getFullCatalog: denied },
  '@/lib/booking/internal-shoot-notes-server': { loadBookingInternalNotes: denied },
  '@/lib/booking/services': {},
  '@/lib/integrations/google-calendar/client': {},
  '@/lib/supabase/server': { getServerSupabase: denied },
  './actions': { updateCalendarSourcePreferences: denied },
});
const menu = renderToStaticMarkup(React.createElement(CalendarSidebar, {
  sources: [], weekStart: '2026-10-18', todayKey: '2026-10-23', visibleItems: [],
}));

function weekFixture(start) {
  return {
    weekStart: start,
    days: Array.from({ length: 7 }, (_, i) => {
      const day = new Date(`${start}T12:00:00Z`);
      day.setUTCDate(day.getUTCDate() + i);
      const key = day.toISOString().slice(0, 10);
      return { key, dateInput: key, enabled: true, workStartMinutes: 540, workEndMinutes: 1020,
        label: day.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }),
        shortLabel: day.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' }) };
    }),
    items: [],
  };
}

const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Calendar from './app/admin/calendar/CalendarWeekView';
    const week = window.fixture;
    createRoot(document.getElementById('root')).render(
      <React.StrictMode><div className="pixel-app-skin studio-workspace admin-earth realtor-theme realtor-backdrop" data-pixel-default-palette="true">
        <main className="studio-content"><p>Local calendar test · no bookings or external services</p>
          <Calendar days={week.days} items={week.items} catalogItems={[]}
            navigation={{previousHref:'/admin/calendar',todayHref:'/admin/calendar',nextHref:'/admin/calendar',search:'fixture search',weekValue:null,clearSearchHref:null}}
            calendarMenu={<div data-fixture-calendar-menu dangerouslySetInnerHTML={{__html:window.fixtureMenu}}/>}/>
        </main>
      </div></React.StrictMode>);
  ` },
  bundle: true, write: false, metafile: true, format: 'iife', platform: 'browser', jsx: 'automatic',
  tsconfig: root + '/tsconfig.json',
  plugins: [{ name: 'read-only-boundaries', setup(b) {
    b.onResolve({ filter: /AddressAutocomplete$/ }, a => ({ path: a.path, namespace: 'address' }));
    b.onLoad({ filter: /.*/, namespace: 'address' }, () => ({ contents: 'export default function AddressAutocomplete(){return null}' }));
    b.onResolve({ filter: /^next\/|\/actions$/ }, a => ({ path: a.path, namespace: 'boundary' }));
    b.onLoad({ filter: /.*/, namespace: 'boundary' }, a => ({ resolveDir: root, contents: a.path === 'next/link'
      ? 'import React from "react";export default function Link({children,...props}){return React.createElement("a",props,children)}'
      : `export const useRouter=()=>({refresh(){throw Error('Unexpected refresh')}});
        const denied=()=>{window.mutationAttempts++;throw Error('No calendar writes in this fixture')};
        export const updateBookingServicesFromCalendar=denied,addCalendarBlock=denied,deleteCalendarBlock=denied,updateCalendarBlock=denied,createAdminShoot=denied,moveCalendarBlock=denied,rescheduleCalendarShoot=denied,searchRealtors=denied;`,
    }));
  } }],
});
if (evidence) fs.writeFileSync(path.join(evidence, 'module-manifest.json'), JSON.stringify(bundle.metafile, null, 2));

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of process.env.CALENDAR_WIDTHS?.split(',').map(Number) ?? [1440, 390, 320, 768, 2560]) {
    const context = await browser.newContext({ viewport: { width, height: Number(process.env.CALENDAR_HEIGHT || 900) }, timezoneId: 'Asia/Tokyo',
      isMobile: width < 768, hasTouch: width < 768 });
    const errors = [], requests = [], unexpected = [];
    let delay = 0;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== 'http://calendar.test' || request.method() !== 'GET') {
        unexpected.push(`${request.method()} ${url}`); return route.abort();
      }
      if (url.pathname === '/api/admin/calendar/week') {
        requests.push(url.searchParams.get('week'));
        assert.equal(url.searchParams.get('q'), 'fixture search');
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        return route.fulfill({ json: weekFixture(url.searchParams.get('week')) });
      }
      if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
      if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css });
      if (url.pathname !== '/admin/calendar') { unexpected.push(url.href); return route.abort(); }
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script>window.mutationAttempts=0;window.fixture=${JSON.stringify(weekFixture('2026-10-18'))};window.fixtureMenu=${JSON.stringify(menu).replaceAll('<', '\\u003c')}</script><script src="/fixture.js"></script></body></html>` });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-23T12:52:00Z'));
    await page.goto('http://calendar.test/admin/calendar');
    const timeline = page.getByRole('region', { name: 'Continuous week calendar' });
    const today = page.getByRole('link', { name: 'Today', exact: true }).filter({ visible: true });
    await expect(timeline).toBeVisible();
    await expect(page.getByText('Loading adjoining weeks…')).toHaveCount(0);
    const position = date => timeline.evaluate((el, date) => {
      const node = el.querySelector(`[data-calendar-day-header="${date}"]`);
      return { left: node ? node.getBoundingClientRect().left - el.getBoundingClientRect().left : null,
        scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, width: el.clientWidth };
    }, date);
    const before = await position('2026-10-23');
    const activateToday = () => width < 768 ? today.tap() : today.click();
    const assertVisibleDate = async date => {
      const label = page.locator('[data-calendar-visible-date]');
      await expect(label).toHaveAttribute('data-calendar-visible-date', date);
      await expect(label.locator('time')).toHaveText(new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      }).format(new Date(`${date}T12:00:00Z`)));
      await expect(page.locator('[data-calendar-day-button][aria-pressed="true"]')).toHaveCount(1);
      await expect(page.locator('[data-calendar-day-button][aria-pressed="true"]')).toHaveAttribute('data-calendar-day-button', date);
      await expect(label).toBeInViewport();
    };
    const leadingDate = () => timeline.evaluate(el => [...el.querySelectorAll('[data-calendar-day-header]')]
      .find(node => node.getBoundingClientRect().right > el.getBoundingClientRect().left + 65)?.dataset.calendarDayHeader);
    const assertSnap = async (date, top) => {
      await expect.poll(async () => (await position(date)).left).toBeCloseTo(64, 0);
      if (top !== undefined) assert.equal((await position(date)).scrollTop, top, 'keep the chosen time of day');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no document overflow');
      if (width < 768 && process.env.CALENDAR_CASE !== 'date-strip') await assertVisibleDate(date);
    };
    if (process.env.CALENDAR_CASE !== 'menu') {
      await activateToday();
      await assertSnap('2026-10-23', before.scrollTop);
    }
    const after = await position('2026-10-23');
    for (let i = 0; i < 3; i++) {
      await activateToday();
      if (process.env.CALENDAR_CASE !== 'menu') await assertSnap('2026-10-23');
    }
    // The second Today control is server-rendered inside the calendar tools.
    await timeline.evaluate(el => { el.scrollLeft = 300; el.scrollTop = 355; });
    await expect.poll(async () => (await position('2026-10-23')).left).toBeGreaterThan(1000);
    if (width < 768) await page.getByRole('button', { name: 'Open calendar tools', exact: true }).click();
    else await page.locator('summary').filter({ hasText: /^Calendars$/ }).click();
    const menuToday = page.locator('[data-fixture-calendar-menu]').getByRole('link', { name: 'Today', exact: true }).filter({ visible: true });
    await menuToday.click();
    await assertSnap('2026-10-23', 355);
    assert.equal(page.url(), 'http://calendar.test/admin/calendar', 'Today stays on the current calendar and keeps search');
    await expect(menuToday).toHaveCount(0);
    if (process.env.CALENDAR_CASE === 'menu') { await context.close(); continue; }

    // Scrolling within the already-selected week must not turn Today into a no-op.
    for (let i = 0; i < 3; i++) {
      await timeline.evaluate(el => { el.scrollLeft += 250; el.scrollTop = 355; });
      await expect.poll(async () => (await position('2026-10-23')).left).toBeLessThan(0);
      await activateToday();
      await assertSnap('2026-10-23', 355);
    }
    if (width < 768) {
      // Choosing a day must move the continuous grid, not just highlight a button.
      const dayStrip = page.locator('.grid-cols-7').filter({ visible: true });
      await dayStrip.getByRole('button').nth(2).tap();
      await assertSnap('2026-10-20', 355);
      if (process.env.CALENDAR_CASE === 'date-strip') { await context.close(); continue; }
      // Partial columns and natural panning keep the date strip honest.
      await timeline.evaluate(el => { el.scrollLeft += 75; });
      await assertVisibleDate('2026-10-20');
      await timeline.evaluate(el => { el.scrollLeft += 60; });
      await assertVisibleDate('2026-10-21');
      const view = name => page.getByRole('button', { name, exact: true }).filter({ visible: true });
      await view('day').tap();
      await assertVisibleDate('2026-10-21');
      await view('week').tap();
      await assertSnap('2026-10-21');
      const cdp = await context.newCDPSession(page);
      const swipe = async (dx, dy) => {
        const box = await timeline.boundingBox();
        const x = dx < 0 ? box.x + box.width - 25 : box.x + 90;
        const y = box.y + Math.min(160, box.height / 2);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let step = 1; step <= 12; step++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 12, y: y + dy * step / 12 }] });
          await page.waitForTimeout(20);
        }
        await page.waitForTimeout(120);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(async () => {
          const first = await timeline.evaluate(el => [el.scrollLeft, el.scrollTop]);
          await page.waitForTimeout(100);
          return timeline.evaluate((el, first) => Math.abs(el.scrollLeft - first[0]) + Math.abs(el.scrollTop - first[1]), first);
        }).toBeLessThan(1);
      };
      for (const dx of [-140, 140]) {
        const left = (await position('2026-10-21')).scrollLeft;
        await swipe(dx, 0);
        const movement = (await position('2026-10-21')).scrollLeft - left;
        assert.ok(dx < 0 ? movement > 50 : movement < -50, 'native touch pans the continuous calendar in both directions');
        await assertVisibleDate(await leadingDate());
      }
      const top = (await position('2026-10-21')).scrollTop;
      await swipe(0, -120);
      assert.ok((await position('2026-10-21')).scrollTop > top + 50, 'native touch scrolls through hours');
      const visibleDate = await leadingDate();
      await assertVisibleDate(visibleDate);
      await expect.poll(() => timeline.locator(`[data-calendar-day-header="${visibleDate}"]`).evaluate(el =>
        el.getBoundingClientRect().top - el.closest('[role="region"]').getBoundingClientRect().top)).toBeCloseTo(1, 0);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await assertVisibleDate(visibleDate);
      await expect(today).toBeInViewport();
      if (evidence) await page.screenshot({ path: path.join(evidence, `mobile-scrolled-${width}.png`) });
      await page.evaluate(() => window.scrollTo(0, 0));
      await cdp.detach();
      await activateToday(); await assertSnap('2026-10-23');
      for (const [direction, dates] of [
        ['Next week', ['2026-10-25', '2026-11-01', '2026-11-08']],
        ['Previous week', ['2026-11-01', '2026-10-25', '2026-10-18']],
      ]) {
        for (const date of dates) {
          await page.getByRole('link', { name: direction, exact: true }).filter({ visible: true }).tap();
          await assertSnap(date);
        }
      }
      await timeline.evaluate(el => { el.scrollTop = 355; });
      await activateToday(); await assertSnap('2026-10-23', 355);
    }
    // Grow beyond the bounded window, then return to a date no longer in the DOM.
    for (let i = 0; i < 8; i++) {
      const previousLast = await timeline.locator('[data-calendar-day-header]').last().getAttribute('data-calendar-day-header');
      if (process.env.CALENDAR_DEBUG) console.log('grow', width, i, previousLast, await timeline.evaluate(el => ({ left: el.scrollLeft, width: el.clientWidth, scrollWidth: el.scrollWidth })), await page.locator('.studio-calendar-scroll-status').innerText());
      await timeline.evaluate(el => { el.scrollLeft = el.scrollWidth; });
      await expect.poll(() => timeline.locator('[data-calendar-day-header]').last().getAttribute('data-calendar-day-header')).not.toBe(previousLast);
      await expect(page.getByText('Loading adjoining weeks…')).toHaveCount(0);
      assert.ok(await timeline.locator('[data-calendar-day-header]').count() <= 49, 'window remains bounded');
    }
    await expect(timeline.locator('[data-calendar-day-header="2026-10-23"]')).toHaveCount(0);
    delay = 80;
    await activateToday(); await activateToday();
    await assertSnap('2026-10-23', 355);
    await expect(page.getByText('Loading adjoining weeks…')).toHaveCount(0);
    delay = 0;
    // A queued scroll frame and Home use the same date jump; week arrows still work.
    await timeline.evaluate(el => { el.scrollLeft += 400; });
    await timeline.focus(); await page.keyboard.press('Home');
    await assertSnap('2026-10-23', 355);
    for (const [key, date] of [['PageDown', '2026-10-25'], ['PageUp', '2026-10-18']]) {
      await page.keyboard.press(key); await assertSnap(date, 355);
    }
    await activateToday(); await assertSnap('2026-10-23', 355);
    if (width === 1440 || width === 390) {
      // Resolve now on each click, even across Toronto midnight on an open tab.
      for (const [instant, date] of [
        ['2026-10-24T03:59:59Z', '2026-10-23'], ['2026-10-24T04:00:00Z', '2026-10-24'],
        ['2026-10-25T04:00:00Z', '2026-10-25'],
        ['2027-01-01T04:59:59Z', '2026-12-31'], ['2027-01-01T05:00:00Z', '2027-01-01'],
        ['2026-03-08T06:59:59Z', '2026-03-08'], ['2026-03-08T07:00:00Z', '2026-03-08'],
        ['2026-11-01T05:59:59Z', '2026-11-01'], ['2026-11-01T06:00:00Z', '2026-11-01'],
        ['2026-11-03T04:59:59Z', '2026-11-02'], ['2026-11-03T05:00:00Z', '2026-11-03'],
      ]) {
        await page.clock.setFixedTime(new Date(instant));
        await activateToday(); await assertSnap(date, 355);
      }
      await page.clock.setFixedTime(new Date('2026-10-23T12:52:00Z'));
      await activateToday(); await assertSnap('2026-10-23', 355);
      // Keep day/agenda preferences and still return to today when the grid remounts.
      const view = name => page.getByRole('button', { name, exact: true }).filter({ visible: true });
      for (const mode of ['day', 'agenda']) {
        await view(mode).click();
        await page.getByRole('link', { name: 'Next week', exact: true }).filter({ visible: true }).click();
        await activateToday();
        await expect(view(mode)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.studio-calendar-scroll-status')).toContainText('Week of 2026-10-18');
        await view('week').click();
        await activateToday(); await assertSnap('2026-10-23');
      }
    }
    await page.clock.setFixedTime(new Date('2026-11-03T12:00:00Z'));
    await activateToday(); await assertSnap('2026-11-03');
    if (evidence) await page.screenshot({ path: path.join(evidence, `today-${width}.png`) });
    results.push({ width, before, after, requests, errors, unexpected });
    assert.equal(await page.evaluate(() => window.mutationAttempts), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    await context.close();
    console.log(`${width}px: toolbar/menu Today, repeated clicks, scroll away/back, evicted date, slow reads, bounded continuous scroll, Home/PageUp/PageDown, vertical position and search passed${width < 768 ? '; date taps, date context, native horizontal/vertical touch, week/month navigation passed' : ''}`);
  }
} catch (error) {
  if (evidence) {
    const page = browser.contexts().at(-1)?.pages().at(-1);
    if (page) {
      await page.screenshot({ path: path.join(evidence, 'failure.png') });
      fs.writeFileSync(path.join(evidence, 'failure.txt'), await page.locator('body').innerText());
    }
  }
  throw error;
} finally {
  await browser.close();
  if (evidence) fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
}
