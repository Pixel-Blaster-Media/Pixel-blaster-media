// Local computed-style regression. Browser tooling is external to production deps.
// Run: PIXEL_BROWSER_TOOLS=/path/to/node_modules node tests/precision-palette.browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const source = path.resolve(process.env.PIXEL_PALETTE_SOURCE || path.resolve(import.meta.dirname, '..'));
const tools = process.env.PIXEL_BROWSER_TOOLS;
assert.ok(tools, 'Set PIXEL_BROWSER_TOOLS to an installed esbuild/playwright node_modules');
const { build } = require(path.join(tools, 'esbuild'));
const { chromium } = require(path.join(tools, 'playwright'));
require('tsx/cjs');
const config = require('../tailwind.config.ts').default;
config.content = [source + '/app/**/*.{ts,tsx}'];
const css = (await require('postcss')([require('tailwindcss')(config), require('autoprefixer')]).process(
  fs.readFileSync(source + '/app/globals.css', 'utf8') + '\n' + fs.readFileSync(source + '/app/precision-skin.css', 'utf8'), { from: source + '/app/globals.css' })).css;
const bundle = await build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {BookingBrandFrame} from './app/book/_components/BookingBrandHeader';
import {organizationThemeStyle} from './lib/organizations/branding';
import {DEFAULT_ORGANIZATION_ID} from './lib/organizations/default';
const {kind,app,nested}=window.fixture;
const organization={id:kind==='default'?DEFAULT_ORGANIZATION_ID:kind==='unknown'?undefined:'custom-id',name:'Same name',primaryColor:kind==='custom'?'#993366':'#3f7356',accentColor:'#c7b17a'};
const controls=<><button id="primary" style={{background:'var(--realtor-primary)',color:'white'}}>Action</button><div id="selected" className="realtor-choice realtor-choice-selected">Selected</div><input id="focus" className="realtor-field" /></>;
createRoot(document.getElementById('root')).render(<div className={app?'pixel-app-skin realtor-theme':'realtor-theme'} {...(!nested?{'data-pixel-default-palette':organization.id===DEFAULT_ORGANIZATION_ID?true:undefined,style:organizationThemeStyle(organization)}:{})}>{nested?<BookingBrandFrame organization={organization}>{controls}</BookingBrandFrame>:controls}</div>);
`, resolveDir: source, loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', tsconfig: source + '/tsconfig.json', plugins: [{ name: 'deny-server', setup(b) {
  b.onResolve({ filter: /^(server-only|@\/lib\/supabase\/server)$/ }, a => ({ path: a.path, namespace: 'denied' }));
  b.onLoad({ filter: /.*/, namespace: 'denied' }, () => ({ contents: 'export const getServiceSupabase=()=>{throw Error("No database in palette test")}' }));
} }] });
// Render the actual async route shells with read-only identity/data boundaries.
const shells = await build({ stdin: { contents: `
import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
import Root from './app/layout'; import Admin from './app/admin/layout'; import Portal from './app/portal/layout'; import Book from './app/book/layout';
import {BookingBrandFrame} from './app/book/_components/BookingBrandHeader';
window.renderShell=async()=>{
 const f=window.fixture, button=<button id="primary" style={{background:'var(--realtor-primary)'}}>Action</button>;
 let child=button;
 if(f.route==='admin')child=await Admin({children:button});
 if(f.route==='portal')child=await Portal({children:button});
 if(f.route==='book')child=<Book><BookingBrandFrame organization={{id:f.bookingId,name:'Same name',primaryColor:f.bookingId==='custom-id'?'#993366':'#3f7356',accentColor:'#c7b17a'}}>{button}</BookingBrandFrame></Book>;
 return renderToStaticMarkup(await Root({children:child}));
};`, resolveDir: source, loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', tsconfig: source + '/tsconfig.json', plugins: [{ name: 'shell-readonly-boundaries', setup(b) {
  b.onResolve({ filter: /\.css$/ }, a => ({ path: a.path, namespace: 'empty' }));
  b.onResolve({ filter: /^(server-only|@\/lib\/auth\/|@\/lib\/supabase\/server|next\/|\.\/AuthSessionHandler|\.\/PwaClient|\.\/_components\/SiteHeaderMobileMenu|\.\/AdminAssistant|\.\/AdminBottomNav)/ }, a => ({ path: a.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => {
    if(a.path==='next/link')return {contents:'import React from "react";export default function Link({children,...props}){return React.createElement("a",props,children)}',resolveDir:source};
    return {contents: `const user=()=>window.fixture.rootId===null?null:{organizationId:window.fixture.rootId,userId:'fixture-user',email:'fixture@example.invalid',role:window.fixture.route==='admin'?'admin':'realtor'};
export const redirect=()=>{throw Error('Unexpected redirect')};export const getCurrentUser=async()=>user();export const requireAdmin=async()=>user();export const requireUser=async()=>user();export const signOut=()=>{throw Error('No actions')};
export const getServiceSupabase=()=>({from:()=>({select:()=>({eq:(_key,id)=>({maybeSingle:async()=>({data:window.fixture.brandFailure?null:{name:'Same name',primary_color:id==='custom-id'?'#993366':'#3f7356',accent_color:'#c7b17a'},error:window.fixture.brandFailure?{message:'fixture failure'}:null})})})})});
export default function Empty(){return null}`};
  });
} }] });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const app of [true, false]) for (const nested of [false, true]) for (const kind of ['default', 'custom', 'unknown']) {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: css });
    await page.evaluate(fixture => { window.fixture = fixture; }, { app, nested, kind });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector('#primary');
    await page.locator('#focus').focus();
    const actual = await page.evaluate(() => {
      const s = id => getComputedStyle(document.getElementById(id));
      const tokens = ['--realtor-primary', '--realtor-primary-rgb', '--realtor-primary-light', '--realtor-primary-light-rgb', '--realtor-primary-dark', '--realtor-primary-dark-rgb', '--realtor-border', '--realtor-accent', '--realtor-accent-rgb'];
      const owner = document.getElementById('primary').parentElement;
      return { primary: s('primary').backgroundColor, rgb: s('primary').getPropertyValue('--realtor-primary-rgb').trim(), border: s('primary').getPropertyValue('--realtor-border').trim(), selected: s('selected').backgroundColor, shadow: s('selected').boxShadow, focus: s('focus').boxShadow, tokens: Object.fromEntries(tokens.map(t => [t, s('primary').getPropertyValue(t).trim()])), inline: Object.fromEntries(tokens.map(t => [t, owner.style.getPropertyValue(t).trim()])) };
    });
    const expected = app && kind === 'default' ? 'rgb(7, 102, 216)' : kind === 'custom' ? 'rgb(153, 51, 102)' : 'rgb(63, 115, 86)';
    const failures = [];
    const blueTokens = {'--realtor-primary':'#0766d8','--realtor-primary-rgb':'7 102 216','--realtor-primary-light':'#005abd','--realtor-primary-light-rgb':'0 90 189','--realtor-primary-dark':'#004fae','--realtor-primary-dark-rgb':'0 79 174'};
    for (const [token, value] of Object.entries(actual.inline)) {
      const target = app && kind==='default' && token in blueTokens ? blueTokens[token] : value;
      if(actual.tokens[token]!==target)failures.push(`${token} ${actual.tokens[token]} !== ${target}`);
    }
    if (actual.primary !== expected) failures.push(`primary ${actual.primary} !== ${expected}`);
    if (kind === 'custom' && !actual.border.includes('153 51 102')) failures.push('custom border overwritten');
    if (app && kind === 'custom') {
      if (!actual.shadow.includes('153, 51, 102')) failures.push('selection shadow not tenant primary');
      if (!actual.focus.includes('153, 51, 102')) failures.push('focus shadow not tenant primary');
      if (!actual.selected.includes('153, 51, 102')) failures.push('selection background not tenant primary');
    }
    results.push({ app, nested, kind, actual, failures });
    await page.close();
  }
  const defaultId = '00000000-0000-0000-0000-000000000001';
  const matrix = [];
  for (const route of ['admin', 'portal', 'nonapp']) for (const rootId of [defaultId, 'custom-id']) for (const brandFailure of [false, true]) matrix.push({ route, rootId, brandFailure });
  for (const rootId of [defaultId, 'custom-id', null]) for (const bookingId of [defaultId, 'custom-id']) matrix.push({ route: 'book', rootId, bookingId });
  matrix.push({route:'nonapp',rootId:null});
  for (const fixture of matrix) {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.evaluate(fixture => { window.fixture = fixture; }, fixture);
    await page.addScriptTag({content: shells.outputFiles[0].text});
    const html = await page.evaluate(() => window.renderShell());
    await page.setContent(html);
    await page.addStyleTag({content:css});
    const actual = await page.evaluate(() => ({primary:getComputedStyle(document.getElementById('primary')).backgroundColor,rootMarker:document.body.getAttribute('data-pixel-default-palette'),markers:document.querySelectorAll('[data-pixel-default-palette="true"]').length}));
    const owner = fixture.route === 'book' ? fixture.bookingId : fixture.rootId;
    const blue = fixture.route !== 'nonapp' && owner === defaultId;
    const expected = blue ? 'rgb(7, 102, 216)' : owner === 'custom-id' && (!fixture.brandFailure || fixture.route === 'book') ? 'rgb(153, 51, 102)' : 'rgb(63, 115, 86)';
    const failures = [];
    if (actual.primary !== expected) failures.push(`primary ${actual.primary} !== ${expected}`);
    if(actual.rootMarker !== (fixture.rootId===null||fixture.rootId===defaultId?'true':null)) failures.push('root marker identity mismatch');
    if(fixture.brandFailure && fixture.rootId==='custom-id' && actual.markers) failures.push('brand failure classified custom as default');
    results.push({fixture,actual,failures});
    await page.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify(results, null, 2));
assert.equal(results.length, 12 + 3 * 2 * 2 + 3 * 2 + 1);
assert.deepEqual(results.filter(r => r.failures.length), [], 'Computed palette contract failures');
