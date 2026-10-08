import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import Renderer, { act } from 'react-test-renderer';
import { loadSource } from './helpers/source-module.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const completion = loadSource('lib/booking/catalog-video-completion.ts', {}, { AbortController, setTimeout, clearTimeout });

async function setup(reply, status = 'uploading') {
  const requests = []; let refreshes = 0;
  const Editor = loadSource('app/admin/settings/pricing/CatalogExamplesEditor.tsx', {
    react: React, 'react/jsx-runtime': jsxRuntime,
    'next/navigation': { useRouter: () => ({ refresh: () => { refreshes++; } }) },
    '@/lib/booking/catalog-video-completion': { waitForCatalogVideoCompletion: (id, opts) => completion.waitForCatalogVideoCompletion(id, {
      ...opts, sleep: async () => {}, fetchImpl: async (url, init) => { requests.push({ url, init }); return reply(); },
    }) },
    '@/lib/booking/catalog-sample-groups': { CATALOG_SAMPLE_GROUP_OPTIONS: [], resolveCatalogSampleGroup: () => ({ label: 'Video' }) },
    './example-actions': new Proxy({}, { get: () => () => { throw Error('No preparation, upload or deletion is allowed'); } }),
    './CatalogVideoUploader': { default: () => null },
  }, { AbortController }).default;
  let tree;
  const props = { catalogItemId: 'catalog', reusableVideos: [], streamConfigured: true,
    examples: [{ id: 'existing-example', source_example_id: 'existing-example', catalog_item_id: 'catalog',
      source_type: 'cloudflare_stream', title: 'Uploaded video', status, active: true,
      video_width: status === 'ready' ? 2160 : null, video_height: status === 'ready' ? 3840 : null }] };
  await act(async () => { tree = Renderer.create(React.createElement(React.StrictMode, null, React.createElement(Editor, props))); });
  return { tree, requests, button: name => tree.root.findAllByType('button').find(n => n.children.join('') === name),
    get refreshes() { return refreshes; } };
}

test('revisiting a pending example checks its existing ID, bounds transient failures and recovers ready', async () => {
  let ready = false;
  const a = await setup(() => ready ? Response.json({ ok: true, status: 'ready' }) : new Response('<html>Access unavailable</html>'));
  assert.equal(a.requests.length, 0);
  await act(async () => a.button('Check processing').props.onClick());
  assert.equal(a.requests.length, 3); assert.equal(a.refreshes, 0);
  assert.equal(a.tree.root.findAll(n => n.props.role === 'alert').length, 0);
  assert.match(a.tree.root.findByProps({ role: 'status' }).children.join(''), /verification is still pending/);
  ready = true; const check = a.button('Check processing').props.onClick;
  await act(async () => { check(); check(); });
  assert.equal(a.requests.length, 4); assert.equal(a.refreshes, 1);
  assert.ok(a.requests.every(r => r.url === '/api/admin/catalog-examples/existing-example/complete' && r.init.body === undefined));
  await act(async () => a.tree.unmount());
  const revisited = await setup(() => { throw Error('Ready example must not poll automatically'); }, 'ready');
  assert.equal(revisited.button('Check processing'), undefined); assert.equal(revisited.requests.length, 0);
  await act(async () => revisited.tree.unmount());
});

test('permission denial is not retried; leaving or refreshing aborts checks and suppresses stale refreshes', async () => {
  const denied = await setup(() => Response.json({ retryable: true }, { status: 401 }));
  await act(async () => denied.button('Check processing').props.onClick());
  assert.equal(denied.requests.length, 1); assert.equal(denied.refreshes, 0);
  assert.match(denied.tree.root.findByProps({ role: 'alert' }).children.join(''), /Sign in again/);
  await act(async () => denied.tree.unmount());
  let resolveCheck;
  const a = await setup(() => new Promise(resolve => { resolveCheck = resolve; }));
  const check = a.button('Check processing').props.onClick;
  await act(async () => { check(); check(); });
  assert.equal(a.requests.length, 1); assert.equal(a.button('Remove').props.disabled, true);
  await act(async () => a.tree.unmount());
  assert.equal(a.requests[0].init.signal.aborted, true);
  await act(async () => resolveCheck(Response.json({ ok: true, status: 'ready' })));
  assert.equal(a.refreshes, 0);
});
