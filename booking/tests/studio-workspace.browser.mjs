// Real admin components, isolated fictional providers, and no production I/O.
// node tests/studio-workspace.browser.mjs [--serve]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(process.env.STUDIO_REVIEW_DIR || path.join(os.tmpdir(), 'pixel-studio-review'));
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-studio-fixture-'));
const { build } = require('esbuild');
const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const axe = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
require('tsx/cjs');
const config = require('../tailwind.config.ts').default;
config.content = [root + '/app/**/*.{ts,tsx}'];
const css = (await require('postcss')([require('tailwindcss')(config), require('autoprefixer')]).process(
  ['globals.css', 'precision-skin.css', 'admin/studio-workspace.css'].map(file => fs.readFileSync(path.join(root, 'app', file), 'utf8')).join('\n'), { from: root + '/app/globals.css' })).css;

const logoUrl = process.env.STUDIO_REVIEW_LOGO ? 'data:image/jpeg;base64,' + fs.readFileSync(process.env.STUDIO_REVIEW_LOGO).toString('base64') : null;
const initial = { lifecycleVersion: 7, scheduledAtLocal: '2026-10-07T09:00', streetAddress: '18 Willow Lane', unitNumber: '', city: 'Hamilton', province: 'ON', postalCode: 'A1A 1A1', squareFootage: '2200', contactName: 'Avery Taylor', contactEmail: 'avery@example.com', contactPhone: '905-555-0142', brokerage: 'Sample Realty', clientNotes: '', selectedCatalogItemIds: ['blueprint'] };
const catalog = [
  ['blueprint', 'The Blue Print', 'bundle', 35000, 80], ['social', 'Social Media Special', 'bundle', 60000, 120], ['plus', 'Social Media PLUS', 'bundle', 72500, 180], ['ultimate', 'The Ultimate', 'bundle', 95000, 240], ['photos', 'Photography', 'a_la_carte', 15000, 45], ['aerial', 'Aerial photos', 'addon', 10000, 20],
].map(([id, name, kind, priceCents, durationMinutes]) => ({ id, name, slug: id, kind, priceCents, durationMinutes, active: true, description: '', badge: null, isPhoto: true, isVideo: false, isIGuide: false, isAerial: false, requireHasVideo: false, requireHasMedia: false, requireHasIGuide: false, excludeHasAerial: false, sqftPricingEnabled: false, includedSqft: null, overageIncrementSqft: null, overagePriceCents: null, videoOverageThresholdSqft: null, videoOveragePriceCents: 0 }));
const rows = [
  ['sample-1', '18 Willow Lane', 'Hamilton', 'Avery Taylor', 'confirmed', '09:00'], ['sample-2', '42 Cedar Close', 'Burlington', 'Jordan Lee', 'confirmed', '11:30'], ['sample-3', '7 Harbour Mews', 'Oakville', 'Morgan Chen', 'editing', '15:00'],
].map(([id, street_address, city, full_name, status, time]) => ({ id, status, lifecycle_version: 7, scheduled_at: `2026-10-07T${String(Number(time.slice(0, 2)) + 4).padStart(2, '0')}:${time.slice(3)}:00Z`, scheduled_ends_at: null, services: ['real_estate_photos', 'iguide_tour'], add_ons: [], square_footage: 2200, unit_number: null, iguide_id: null, iguide_portal_id: null, client_notes: null, created_at: '2026-10-01T12:00:00Z', properties: { street_address, city, province: 'ON', postal_code: 'A1A 1A1' }, profiles: { full_name, email: 'sample@example.com', phone: '905-555-0142', brokerage: 'Sample Realty', internal_notes: null, delivery_cc_emails: [], ai_memory: null } }));

function weekFixture(start) {
  const date = new Date(`${start}T12:00:00Z`);
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(date); day.setUTCDate(day.getUTCDate() + i); const key = day.toISOString().slice(0, 10);
    return { key, dateInput: key, enabled: day.getUTCDay() !== 0, workStartMinutes: 540, workEndMinutes: 1020, label: day.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }), shortLabel: day.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' }) };
  });
  const items = [1, 3, 5].map((index, i) => ({ id: `fixture-${days[index].key}`, kind: 'booking', title: rows[i].properties.street_address, subtitle: rows[i].profiles.full_name, localDate: days[index].key, startsAt: `${days[index].key}T13:00:00Z`, endsAt: `${days[index].key}T14:20:00Z`, href: '/admin/bookings/sample-1', statusLabel: 'Confirmed', statusClass: 'border-teal-200 bg-teal-50 text-teal-900', bookingDetails: { lifecycleVersion: 7, fullAddress: rows[i].properties.street_address, services: ['real_estate_photos'], addOns: [], realtorName: rows[i].profiles.full_name, realtorEmail: 'sample@example.com', realtorPhone: '905-555-0142', brokerage: 'Sample Realty', realtorNotes: null, clientNotes: null, internalNotes: null, propertyNotes: null, squareFootage: 2200, occupancy: null, includeBasement: null, basementDurationMinutes: 0, lineSnapshots: [], selectedCatalogItemIds: ['blueprint'], hasInvoice: false, realtorNotificationsSuppressed: true } }));
  return { weekStart: start, days, items, googleLoadFailed: false };
}

const common = `import React from 'react';
export const AppRouterContext=React.createContext(null);
export const notFound=()=>{throw Error('Fixture booking not found')};
export default function Link({children,href,...props}){return <a href={href} {...props}>{children}</a>}
export const usePathname=()=>window.fixture.pathname;
export const useRouter=()=>({refresh(){window.fixture.refreshes++},push(href){location.href=href},replace(href){location.href=href}});
export const useSearchParams=()=>new URLSearchParams(location.search);
export const redirect=()=>{throw Error('No real auth navigation in fixture')};
export const requireAdmin=async()=>({organizationId:'sample-org',userId:'sample-user',email:'studio@example.com'});
export const loadBookingInternalNotes=async()=>new Map();
export const loadBookingInternalNote=async()=>({notes:null,revision:0});
export const getFullCatalog=async()=>({bundles:${JSON.stringify(catalog.filter(x=>x.kind==='bundle'))},aLaCarte:${JSON.stringify(catalog.filter(x=>x.kind==='a_la_carte'))},addons:${JSON.stringify(catalog.filter(x=>x.kind==='addon'))}});
export const hasPortalCredentials=async()=>false;export const isPhotoEditingProviderEnabled=async()=>false;export const listBookingAutoenhanceBatches=async()=>[];
export const loadTodayCommandPreferences=async()=>({showShootBrief:false,showAgentNotes:true,showPropertyNotes:true,showClientNotes:true});
export const loadShootWeather=async()=>({temperatureC:18,windKph:9,cloudCover:20,precipitationProbability:10,weatherCode:2,location:'Hamilton'});
export const getCredential=async()=>null;
export const getServiceSupabase=()=>({from(){const q=new Proxy({},{get(_,key){if(['insert','update','delete','upsert'].includes(key))throw Error('No fixture server writes');if(key==='then')return r=>r({data:[],error:null});return()=>q}});return q}});
export const getServerSupabase=async()=>({rpc:async(_name,args)=>({data:${JSON.stringify(rows)}.filter(row=>(args.p_filter==='all'||args.p_filter==='active'||row.status===args.p_filter)&&(!args.p_query||JSON.stringify(row).toLowerCase().includes(args.p_query.toLowerCase()))),error:null}),from(table){const response={data:table==='bookings'?${JSON.stringify(rows)}:[],error:null};const q=new Proxy({}, {get(_,key){if(key==='then')return r=>r(response);if(key==='single')return()=>Promise.resolve({...response,data:response.data[0]});return()=>q}});return q}});
export const action=async(...args)=>{if(typeof window==='undefined')throw Error('No server mutation');window.fixture.actions.push(args.map(x=>x instanceof FormData?Object.fromEntries(x):x));await new Promise(r=>setTimeout(r,window.fixture.delay||0));if(window.fixture.saveMode==='throw')throw Error('Fixture connection interrupted');if(window.fixture.saveMode==='reject')return{ok:false,error:'Booking changed in another session. Refresh before saving.'};return{ok:true,lifecycleVersion:8,confirmationSent:false}};
`;
function plugin(server = false) { return { name: 'isolated-providers', setup(b) {
  if(server)b.onResolve({filter:/^\.\/EditBookingForm$/},a=>({path:a.path,namespace:'editor-island'}));
  b.onLoad({filter:/.*/,namespace:'editor-island'},()=>({contents:`import React from 'react';export default function Editor(){return <div data-editor-island/>}`,resolveDir:root,loader:'tsx'}));
  b.onResolve({filter:/^@\/lib\/(booking\/catalog$|integrations\/(iguide\/portal-client$|provider-enablement$|autoenhance\/workflow$))/},a=>({path:a.path,namespace:'fixture'}));
  b.onResolve({ filter: /\.css$/ }, a => ({ path: a.path, namespace: 'empty' }));
  b.onResolve({ filter: /^(next\/|server-only$|@\/lib\/auth\/|@\/lib\/supabase\/server$|@\/lib\/booking\/internal-shoot-notes-server$|@\/lib\/integrations\/credentials$)/ }, a => ({ path: a.path, namespace: 'fixture' }));
  b.onResolve({ filter: /^(\.\/weather)$/ }, a => ({ path: a.path, namespace: 'fixture' }));
  b.onResolve({ filter: /(?:^|\/)actions$/ }, a => {
    const real = a.path.startsWith('@/') ? path.join(root, a.path.slice(2)) : path.resolve(path.dirname(a.importer), a.path);
    return { path: real, namespace: 'actions' };
  });
  b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: common, resolveDir: root, loader: 'tsx' }));
  b.onLoad({ filter: /.*/, namespace: 'actions' }, a => {
    const source = fs.readFileSync(a.path + '.ts', 'utf8');
    const names = [...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(m => m[1]);
    return { contents: common + '\n' + names.filter(name => name !== 'loadTodayCommandPreferences').map(name => `export const ${name}=action;`).join('\n'), resolveDir: root, loader: 'tsx' };
  });
} }; }

await build({ stdin: { contents: `import React from 'react';import{renderToPipeableStream}from'react-dom/server';import{PassThrough}from'node:stream';import Today from './app/admin/today/page';import Jobs from './app/admin/bookings/page';import Detail from './app/admin/bookings/[id]/page';
export async function render(view,params){const tree=view==='today'?await Today():view==='booking'?await Detail({params:Promise.resolve({id:'sample-1'}),searchParams:Promise.resolve({tab:'details'})}):await Jobs({searchParams:Promise.resolve(params)});return await new Promise((resolve,reject)=>{const out=new PassThrough();let html='';out.on('data',chunk=>html+=chunk);out.on('end',()=>resolve(html));const stream=renderToPipeableStream(tree,{onAllReady(){stream.pipe(out)},onError:reject});});}`, resolveDir: root, loader: 'tsx' }, platform: 'node', format: 'cjs', bundle: true, outfile: temp + '/server.cjs', jsx: 'automatic', tsconfig: root + '/tsconfig.json', plugins: [plugin(true)], logLevel: 'warning' });
const render = require(temp + '/server.cjs').render;
const browserBundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Shell from './app/admin/AdminWorkspace';import Edit from './app/admin/bookings/[id]/EditBookingForm';import Calendar from './app/admin/calendar/CalendarWeekView';import Heading from './app/admin/AdminPageHeading';
const f=window.fixture;function activateStream(root){for(const old of root.querySelectorAll('script')){const script=document.createElement('script');script.textContent=old.textContent;old.replaceWith(script)}}function Markup(){const ref=React.useRef(null);React.useLayoutEffect(()=>activateStream(ref.current),[]);return <div ref={ref} dangerouslySetInnerHTML={{__html:f.markup}}/>}function Booking(){const ref=React.useRef(null);React.useEffect(()=>{activateStream(ref.current);const root=createRoot(ref.current.querySelector('[data-editor-island]'));root.render(<Edit bookingId='sample-1' initial={f.initial} catalogItems={f.catalog}/>);return()=>root.unmount()},[]);return <div ref={ref} dangerouslySetInnerHTML={{__html:f.markup}}/>;}const child=f.view==='booking'?<Booking/>:f.view==='calendar'?<><Heading eyebrow='Schedule' title='Calendar' meta='Scroll across weeks. Keep your day in view.'/><Calendar days={f.week.days} items={f.week.items} catalogItems={f.catalog} navigation={{previousHref:'/admin/calendar?week=2026-09-27',todayHref:'/admin/calendar',nextHref:'/admin/calendar?week=2026-10-11',search:'',weekValue:null,clearSearchHref:null}} calendarMenu={<p className='p-4'>Sample calendar · fictional data</p>}/></>:<Markup/>;
createRoot(document.getElementById('root')).render(<div className='pixel-app-skin studio-workspace admin-earth realtor-theme realtor-backdrop' data-pixel-default-palette='true'><Shell name='Pixel Blaster Media' logoUrl={f.logoUrl} signOutAction={async()=>{throw Error('No real sign-out')}}>{child}</Shell></div>);`, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: root + '/tsconfig.json', plugins: [plugin()], define: { 'process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY': 'undefined' }, logLevel: 'warning' });
const requests = [];
const weekFailures = new Set();
let weekDelay = 0;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/admin/calendar/week') {
      const week = url.searchParams.get('week'); requests.push(week);
      await new Promise(resolve => setTimeout(resolve, weekDelay));
      res.setHeader('Content-Type', 'application/json');
      if (weekFailures.has(week)) { res.statusCode = 503; res.end(JSON.stringify({ error: 'Fixture week unavailable' })); return; }
      res.end(JSON.stringify(weekFixture(week)));return;
    }
    if (url.pathname === '/fixture.js') { res.setHeader('Content-Type','text/javascript');res.end(browserBundle.outputFiles[0].text);return; }
    const view = url.pathname.includes('/calendar') ? 'calendar' : url.pathname.includes('/bookings/sample') ? 'booking' : url.pathname.includes('/bookings') ? 'jobs' : 'today';
    const fixture = { logoUrl, view, pathname: url.pathname, initial, catalog, week: weekFixture('2026-10-04'), actions: [], refreshes: 0, saveMode: 'success', markup: ['today','jobs','booking'].includes(view) ? await render(view, Object.fromEntries(url.searchParams)) : '' };
    if (view==='today') fs.writeFileSync(temp+'/today.html',fixture.markup);
    res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Studio Workspace · implementation review</title><style>${css}</style></head><body><div style="padding:8px 18px;background:#edf3f1;color:#28545a;font:12px system-ui;text-align:right">ACTUAL COMPONENTS · FICTIONAL DATA · LOCAL REVIEW</div><div id="root"></div><script>window.fixture=${JSON.stringify(fixture).replaceAll('<','\\u003c')}</script><script src="/fixture.js"></script></body></html>`);
  } catch(error) { console.error(error); res.statusCode=500;res.end(String(error)); }
});
await new Promise(resolve => server.listen(8766, '127.0.0.1', resolve));
if (process.argv.includes('--serve')) { console.log('Implementation fixture: http://127.0.0.1:8766/admin/today'); }
else {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const errors = [], external = [];
  await context.route('**/*', route => { if(new URL(route.request().url()).hostname !== '127.0.0.1'){external.push(route.request().url());return route.abort()}return route.continue(); });
  const page = await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-10-07T16:00:00Z'));
  const screens=[], accessibility=[], checks=[];
  try {
    for(const width of [1440,390,768])for(const [screen,route]of [['Today','today'],['Bookings','bookings'],['Editor','bookings/sample-1?tab=details'],['Calendar','calendar']]){
      await page.setViewportSize({width,height:1000});assert.equal((await page.goto('http://127.0.0.1:8766/admin/'+route)).status(),200,screen);await page.locator('.studio-content').waitFor();await page.waitForTimeout(200);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${screen} ${width}`);
      const filename=`Studio-Implementation-${screen}-${width}.png`;await page.screenshot({path:path.join(output,filename),fullPage:true});screens.push(filename);
      if(width===390){if(screen==='Editor')await page.locator('.studio-editor-grid').scrollIntoViewIfNeeded();const phone=`Studio-Implementation-${screen}-Phone.png`;await page.screenshot({path:path.join(output,phone)});screens.push(phone);await page.evaluate(()=>window.scrollTo(0,0));}
      await page.addScriptTag({ content: axe });
      const violations = await page.evaluate(async () => (await window.axe.run('.studio-workspace', { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa'] } })).violations.map(v => ({ id:v.id, impact:v.impact, nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary})) })));
      accessibility.push({screen,width,violations});
    }
    // Test native scrolling and the actual read-only loading hook.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('http://127.0.0.1:8766/admin/calendar');
    const timeline = page.getByRole('region', { name: 'Continuous week calendar' });
    await expect(page.getByText('Loading adjoining weeks…')).toHaveCount(0);
    const box = await timeline.boundingBox();
    await page.mouse.move(box.x + 400, box.y + 200);
    const beforeWheel = await timeline.evaluate(el => el.scrollLeft);
    await page.mouse.wheel(520, 0);
    await expect.poll(() => timeline.evaluate(el => el.scrollLeft)).toBeGreaterThan(beforeWheel + 300);
    const beforeShift = await timeline.evaluate(el => el.scrollLeft);
    await page.keyboard.down('Shift'); await page.mouse.wheel(0, 300); await page.keyboard.up('Shift');
    await expect.poll(() => timeline.evaluate(el => el.scrollLeft)).toBeGreaterThan(beforeShift + 150);
    const beforeVertical = await timeline.evaluate(el => el.scrollTop);
    await page.mouse.wheel(0, 240);
    await expect.poll(() => timeline.evaluate(el => el.scrollTop)).toBeGreaterThan(beforeVertical);
    checks.push('trackpad horizontal, mouse vertical and Shift-wheel');
    weekDelay = 100;
    for (let i = 0; i < 9; i++) {
      const previousLast = await page.locator('[data-calendar-day-header]').last().getAttribute('data-calendar-day-header');
      await timeline.evaluate(el => { el.scrollTop = 285; el.scrollLeft = el.scrollWidth - el.clientWidth; });
      await expect.poll(() => page.locator('[data-calendar-day-header]').last().getAttribute('data-calendar-day-header')).not.toBe(previousLast);
      await expect(page.getByText('Loading adjoining weeks…')).toHaveCount(0);
      assert.ok(await page.locator('[data-calendar-day-header]').count() <= 49);
      assert.ok(Math.abs(await timeline.evaluate(el => el.scrollTop) - 285) < 2);
      const ids = await page.locator('[data-calendar-item]').evaluateAll(els => els.map(el => el.dataset.calendarItem));
      assert.equal(new Set(ids).size, ids.length, 'no duplicated bookings');
      assert.equal(ids.length, (await page.locator('[data-calendar-day-header]').count()) / 7 * 3, 'no missing fixture bookings');
    }
    // Prepending a week keeps the first visible date and hour in place.
    await timeline.evaluate(el => { el.scrollLeft = 0; el.scrollTop = 340; });
    const anchor = await timeline.evaluate(el => { const n=el.querySelector('[data-calendar-day-header]'); return { date:n.dataset.calendarDayHeader, x:n.getBoundingClientRect().left-el.getBoundingClientRect().left }; });
    await expect(page.getByText('Loading adjoining weeks…')).toHaveCount(0);
    await page.waitForTimeout(160);
    const preserved = await timeline.evaluate((el,date) => ({ x:el.querySelector(`[data-calendar-day-header="${date}"]`).getBoundingClientRect().left-el.getBoundingClientRect().left, top:el.scrollTop }),anchor.date);
    assert.ok(Math.abs(preserved.x-anchor.x)<2); assert.equal(preserved.top,340);
    checks.push('bounded 7-week window, prepend anchoring, vertical position, no missing/duplicate bookings');
    await timeline.focus(); await page.keyboard.press('Home');
    await expect(page.locator('.studio-calendar-scroll-status')).toContainText('Week of 2026-10-04');
    await expect(page.getByText('Loading adjoining weeks…')).toHaveCount(0);
    await page.keyboard.press('PageDown');
    await expect(page.locator('.studio-calendar-scroll-status')).toContainText('Week of 2026-10-11');
    await page.keyboard.press('PageUp');
    await expect(page.locator('.studio-calendar-scroll-status')).toContainText('Week of 2026-10-04');
    checks.push('keyboard next/previous weeks and Today');
    weekFailures.add('2026-10-11');
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Some weeks could not load');
    assert.ok(await page.locator('[data-calendar-item]').count() >= 3);
    weekFailures.clear(); await page.getByRole('button',{name:'Try again',exact:true}).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('Loading adjoining weeks…')).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.fixture.actions),[]);
    checks.push('failed adjacent-week retry retains loaded data; scrolling never mutates');
    weekDelay = 0;
    await page.getByRole('button',{name:/^Day$/i}).filter({visible:true}).click();
    await expect(page.locator('[data-calendar-day-header]')).toHaveCount(1);
    await page.getByRole('button',{name:/^Agenda$/i}).filter({visible:true}).click();
    await expect(timeline).toHaveCount(0);
    await page.getByRole('button',{name:/^Week$/i}).filter({visible:true}).click();
    await expect(timeline).toBeVisible();
    checks.push('day and agenda views retained alongside continuous weeks');
    await timeline.focus(); await page.keyboard.press('Home');
    await expect(page.getByText('Loading adjoining weeks…')).toHaveCount(0);
    await timeline.evaluate(el=>el.scrollTop=0);
    const shoot = page.locator('[data-calendar-item="booking:fixture-2026-10-07:2026-10-07"]');
    await shoot.click(); await page.locator('summary').filter({hasText:'Change date & time'}).click(); await expect(page.getByRole('button',{name:'Save new date & time'})).toHaveCount(1);
    await page.getByTitle('Close',{exact:true}).click();
    const dragBox=await shoot.boundingBox();
    await page.mouse.move(dragBox.x+30,dragBox.y+25);await page.mouse.down();
    await page.mouse.move(dragBox.x+30,dragBox.y+73,{steps:8});await page.mouse.up();
    await expect.poll(()=>page.evaluate(()=>window.fixture.actions.length)).toBe(1);
    const moved=await page.evaluate(()=>window.fixture.actions[0]);assert.equal(moved[0],'fixture-2026-10-07');assert.equal(moved[1],'2026-10-07');assert.equal(moved[2],570);
    checks.push('booking quick view and deliberate mouse drag reschedule still call the existing action');

    // Failed or interrupted saves retain input and the request/version tokens.
    await page.goto('http://127.0.0.1:8766/admin/bookings/sample-1?tab=details');
    await page.locator('[name="contact_name"]').fill('Edited Sample Realtor');
    await page.evaluate(() => { window.fixture.saveMode='reject'; window.fixture.delay=100; });
    await page.getByRole('button',{name:'Save booking',exact:true}).click();
    await expect(page.locator('[name="contact_name"]')).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('Booking changed');
    await expect(page.locator('[name="contact_name"]')).toHaveValue('Edited Sample Realtor');
    await page.evaluate(() => { window.fixture.saveMode='throw'; });
    await page.getByRole('button',{name:'Save booking',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('save could not be confirmed');
    await expect(page.locator('[name="contact_name"]')).toHaveValue('Edited Sample Realtor');
    await page.evaluate(() => { window.fixture.saveMode='success'; });
    await page.getByRole('button',{name:'Save booking',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'Booking saved.'})).toBeVisible();
    await page.locator('[name="contact_name"]').fill('Second Sample Edit');
    await page.getByRole('button',{name:'Save booking',exact:true}).click();
    await expect.poll(() => page.evaluate(()=>window.fixture.actions.length)).toBe(4);
    const saves = await page.evaluate(()=>window.fixture.actions.map(args=>args[1]));
    assert.equal(saves[0].admin_request_id,saves[1].admin_request_id); assert.equal(saves[1].admin_request_id,saves[2].admin_request_id);
    assert.notEqual(saves[2].admin_request_id,saves[3].admin_request_id);
    assert.equal(saves[0].lifecycle_version,'7');assert.equal(saves[3].lifecycle_version,'8');
    assert.ok(saves.every(save=>!save.send_confirmation));
    await expect(page.getByRole('button',{name:'Save booking',exact:true})).toBeEnabled();
    await page.locator('[name="contact_name"]').fill('Unsaved edit');
    page.once('dialog',dialog=>dialog.dismiss());
    await page.locator('.studio-sidebar').getByRole('link',{name:'Calendar',exact:true}).click();
    await expect(page.locator('[name="contact_name"]')).toHaveValue('Unsaved edit');
    await page.getByRole('button',{name:'Discard',exact:true}).click();
    await expect(page.locator('[name="contact_name"]')).toHaveValue(initial.contactName);
    checks.push('rejected/interrupted save retains input, retry idempotency, next-edit version, explicit email opt-in, dirty-link guard and discard');
    // Global search uses the real list query surface.
    await page.locator('#studio-search').fill('Willow'); await page.getByRole('button',{name:'Search bookings',exact:true}).click();
    await expect(page.locator('.studio-booking-row')).toHaveCount(1);
    checks.push('booking search');
    // Touch gestures are native scrolling, with no drag/save side effects.
    const touch = await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    await touch.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const mobile = await touch.newPage(); await mobile.clock.setFixedTime(new Date('2026-10-07T16:00:00Z')); await mobile.goto('http://127.0.0.1:8766/admin/calendar');
    const mobileTimeline = mobile.getByRole('region',{name:'Continuous week calendar'});
    await expect(mobile.getByText('Loading adjoining weeks…')).toHaveCount(0);
    await mobileTimeline.scrollIntoViewIfNeeded();
    const touchBox = await mobileTimeline.boundingBox(), cdp = await touch.newCDPSession(mobile);
    const touchStart = await mobileTimeline.evaluate(el=>el.scrollLeft);
    const y=touchBox.y+170;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:330,y}]});
    for(let x=310;x>=100;x-=30) { await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]}); await mobile.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(()=>mobileTimeline.evaluate(el=>el.scrollLeft)).toBeGreaterThan(touchStart+80);
    assert.deepEqual(await mobile.evaluate(()=>window.fixture.actions),[]);
    await mobile.locator('.studio-more summary').click();await expect(mobile.locator('.studio-more')).toHaveAttribute('open','');
    await mobile.keyboard.press('Escape');await expect(mobile.locator('.studio-more')).not.toHaveAttribute('open','');
    await expect(mobile.locator('.studio-more summary')).toBeFocused();
    checks.push('touch week scrolling without mutation; mobile More and Escape focus');
    await touch.close();
    fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({screens,checks,accessibility,requests,errors,external},null,2));
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const violations=accessibility.flatMap(result=>result.violations.map(v=>({...v,screen:result.screen,width:result.width})));
    console.log(JSON.stringify({screens:screens.length,checks,violations,errors,external,output},null,2));
    assert.deepEqual(violations,[],'WCAG A/AA issues');
  } finally {await browser.close();server.close();}
}
