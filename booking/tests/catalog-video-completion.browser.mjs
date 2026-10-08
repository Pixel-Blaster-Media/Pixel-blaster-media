// Actual React controls and browser navigation; all provider/API traffic is synthetic and loopback-only.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';

const root = path.resolve(import.meta.dirname, '..');
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Uploader from './app/admin/settings/pricing/CatalogVideoUploader';
    import Editor from './app/admin/settings/pricing/CatalogExamplesEditor';
    function App(){const [closed,setClosed]=React.useState(false);
      if(location.pathname==='/blank')return <p>Another view</p>;
      if(location.pathname==='/examples')return <Editor catalogItemId='fixture-catalog' examples={[window.example]} reusableVideos={[]} streamConfigured={true}/>;
      return closed?<p role='status'>Uploader closed safely.</p>:<Uploader catalogItemId='fixture-catalog'
        onBusyChange={()=>{}} onComplete={()=>{window.completions++;setClosed(true)}}
        createTransfer={async(file,options)=>({start(){window.transfers++;queueMicrotask(()=>{options.onProgress(file.size,file.size);options.onSuccess()})},async abort(){window.aborts++}})}/>;
    }
    window.transfers=0;window.aborts=0;window.completions=0;
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
  ` },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  tsconfig: path.join(root, 'tsconfig.json'), logLevel: 'warning',
  plugins: [{ name: 'local-only-boundaries', setup(b) {
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'mock' }));
    b.onResolve({ filter: /(?:^|\/)example-actions$/ }, () => ({ path: 'actions', namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => ({
      contents: name === 'navigation' ? 'export const useRouter=()=>({refresh(){location.reload()}});'
        : 'const reject=async()=>{throw Error("No mutation actions in this fixture")};export const attachCatalogExample=reject,attachSharedCatalogVideo=reject,deleteCatalogExample=reject,removeSharedCatalogVideoPlacement=reject;',
    }));
  } }],
});

let mode = 'recover', checks = 0, preparations = 0, rowReady = false;
const requests = [], errors = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/fixture.js') {
    res.setHeader('Content-Type', 'text/javascript'); return res.end(bundle.outputFiles[0].text);
  }
  if (url.pathname.startsWith('/api/')) {
    requests.push({ method: req.method, path: url.pathname });
    assert.equal(req.method, 'POST'); res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/api/admin/catalog-examples/upload') {
      preparations++;
      return res.end(JSON.stringify({ exampleId: 'existing-example', uploadUrl: 'https://upload.videodelivery.net/synthetic-unused',
        expiresAt: new Date(Date.now() + 3600_000).toISOString() }));
    }
    assert.equal(url.pathname, '/api/admin/catalog-examples/existing-example/complete');
    checks++;
    if (mode === 'deny') { res.statusCode = 403; return res.end(JSON.stringify({ retryable: true })); }
    if (mode === 'processing') { res.statusCode = 202; return res.end(JSON.stringify({ status: 'processing' })); }
    if (mode === 'unavailable' || mode === 'recover' && checks === 1) {
      res.statusCode = 503;
      return res.end(JSON.stringify({ status: 'verification_pending', code: 'authentication_unavailable', retryable: true }));
    }
    if (mode === 'recover' && checks === 2) {
      res.setHeader('Content-Type', 'text/html'); return res.end('<html>Temporary gateway problem</html>');
    }
    rowReady = true; return res.end(JSON.stringify({ ok: true, status: 'ready' }));
  }
  const example = { id: 'existing-example', source_example_id: 'existing-example', catalog_item_id: 'fixture-catalog',
    source_type: 'cloudflare_stream', title: 'Synthetic uploaded video', status: rowReady ? 'ready' : 'uploading',
    active: true, video_width: rowReady ? 2160 : null, video_height: rowReady ? 3840 : null };
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px sans-serif;margin:12px}input{max-width:100%}button{padding:12px;margin:4px}</style><body><a href="/blank">Leave view</a><div id="root"></div><script>window.example=${JSON.stringify(example)}</script><script src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) {
        errors.push('External request attempted'); return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const reset = async nextMode => {
      mode = nextMode; checks = 0; preparations = 0; rowReady = false; requests.length = 0;
      await page.goto(origin + '/upload');
    };
    const start = async () => {
      await page.getByLabel('Example title').fill('Synthetic upload');
      await page.getByLabel('Video file', { exact: true }).setInputFiles({ name: 'fixture.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(1024) });
      await page.getByRole('button', { name: 'Upload video', exact: true }).click();
    };
    await reset('recover'); await start();
    await expect(page.getByRole('status')).toContainText('verification is temporarily unavailable');
    await expect(page.getByRole('status')).toHaveText('Uploader closed safely.', { timeout: 15_000 });
    assert.equal(checks, 3); assert.equal(preparations, 1);
    assert.equal(await page.evaluate(() => window.transfers), 1);
    await page.goto(origin + '/examples');
    await expect(page.getByText('Synthetic uploaded video', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check processing', exact: true })).toHaveCount(0);
    await page.reload(); assert.equal(checks, 3); assert.equal(preparations, 1);

    await reset('unavailable'); await start();
    await expect(page.getByRole('button', { name: 'Check processing', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    assert.equal(checks, 3);
    // Two DOM clicks in one event turn exercise the ref fence before React commits a disabled state.
    await page.getByRole('button', { name: 'Check processing', exact: true }).evaluate(button => { button.click(); button.click(); });
    await expect.poll(() => checks).toBe(4);
    await page.getByRole('button', { name: 'Close uploader' }).click();
    await expect(page.getByRole('status')).toHaveText('Uploader closed safely.');
    await page.waitForTimeout(3200); assert.equal(checks, 4); assert.equal(preparations, 1);
    assert.equal(await page.evaluate(() => window.completions), 1);

    await reset('deny'); await start();
    await expect(page.getByRole('alert')).toContainText('permission');
    await expect(page.getByRole('button', { name: 'Check processing', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Resume upload', exact: true })).toHaveCount(0);
    assert.equal(checks, 1); assert.equal(preparations, 1);

    await reset('processing'); await start();
    await expect(page.getByRole('status')).toContainText('still processing');
    const beforeLeave = checks;
    await page.getByRole('link', { name: 'Leave view' }).click();
    await page.goBack();
    await page.waitForTimeout(3200); assert.equal(checks, beforeLeave); assert.equal(preparations, 1);
    await page.goto(origin + '/examples');
    await page.getByRole('button', { name: 'Check processing', exact: true }).click();
    await expect.poll(() => checks).toBe(beforeLeave + 1);
    await page.reload(); const afterReload = checks;
    await page.waitForTimeout(3200); assert.equal(checks, afterReload); assert.equal(preparations, 1);
    mode = 'ready';
    await page.getByRole('button', { name: 'Check processing', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Check processing', exact: true })).toHaveCount(0);
    assert.equal(preparations, 1);
    assert.ok(requests.every(r => r.path.endsWith('/complete') || r.path === '/api/admin/catalog-examples/upload'));
    await context.close();
    console.log(`${width}px: auth/HTML recovery, bounded retries, denial, duplicate clicks, close, refresh and Back passed; one synthetic transfer per uploader`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
