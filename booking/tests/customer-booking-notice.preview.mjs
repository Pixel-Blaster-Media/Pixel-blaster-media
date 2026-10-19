/** Local visual fixture for the actual checkbox component. No live SDKs/env. */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const { build } = require('esbuild');
require('tsx/cjs');
const config = require('../tailwind.config.ts').default;
config.content = [root + '/app/admin/settings/availability/BookingNoticeEditor.tsx'];
const css = (await require('postcss')([require('tailwindcss')(config), require('autoprefixer')]).process(
  readFileSync(root + '/app/globals.css', 'utf8'), { from: root + '/app/globals.css' })).css;
const bundle = await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Editor from './app/admin/settings/availability/BookingNoticeEditor';createRoot(document.getElementById('root')).render(<Editor enabled={window.fixtureEnabled}/>);`, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  plugins: [{ name: 'local-only-action', setup(b) {
    b.onResolve({ filter: /^\.\/actions$/ }, () => ({ path: 'fixture-actions', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export async function saveBookingNotice(form){const result=await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:form.get('require_24_hour_notice')==='on'})});return result.json();}`, loader: 'js' }));
  } }],
});
let enabled = false;
const server = http.createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/save' && request.method === 'POST') {
    let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 1000) { response.writeHead(413).end(); return; } }
    const input = JSON.parse(body);
    if (typeof input.enabled !== 'boolean') { response.writeHead(400).end(); return; }
    enabled = input.enabled;
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true })); return;
  }
  if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return; }
  if (request.url !== '/' || request.method !== 'GET') { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pixel · 24-hour booking notice review</title><style>${css}</style></head><body class="realtor-theme"><main style="max-width:860px;margin:48px auto;padding:24px"><p style="font-size:12px;color:#526866">LOCAL REVIEW · ACTUAL COMPONENT · SYNTHETIC SETTINGS</p><h1 style="font-size:32px;font-weight:600;margin:16px 0 24px">Availability</h1><div id="root"></div><p style="font-size:13px;color:#526866;margin-top:24px">This fixture stores only a temporary local checkbox value. No bookings, emails, accounts or live settings are changed.</p></main><script>window.fixtureEnabled=${JSON.stringify(enabled)}</script><script src="/fixture.js"></script></body></html>`);
});
server.listen(0, '127.0.0.1', () => console.log(`Local notice review: http://127.0.0.1:${server.address().port}/`));
