import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './helpers/source-module.mjs';

const { waitForCatalogVideoCompletion } = loadSource('lib/booking/catalog-video-completion.ts', {}, {
  AbortController, setTimeout, clearTimeout,
});
const ready = () => Response.json({ ok: true, status: 'ready' });
const processing = () => Response.json({ status: 'processing' }, { status: 202 });
const unavailable = () => Response.json({ code: 'authentication_unavailable', retryable: true }, { status: 503 });

async function check(responses, { controller = new AbortController(), fetchDelay = 0, ...options } = {}) {
  const requests = [], notices = [];
  let clock = 0;
  const result = await waitForCatalogVideoCompletion('existing/example', {
    signal: controller.signal,
    now: () => clock,
    sleep: async ms => { clock += ms; },
    onPending: message => notices.push(message),
    fetchImpl: async (url, init) => {
      requests.push({ url, init }); clock += fetchDelay;
      const response = responses[Math.min(requests.length - 1, responses.length - 1)];
      if (response instanceof Error) throw response;
      return response();
    },
    ...options,
  });
  return { result, requests, notices, clock };
}

test('temporary authentication failure and HTML response recover by checking only the existing example', async () => {
  const a = await check([unavailable, () => new Response('<html>Unavailable</html>'), ready]);
  assert.equal(a.result.status, 'ready');
  assert.equal(a.requests.length, 3);
  assert.ok(a.notices.every(n => /verification.*temporarily unavailable/.test(n)));
  for (const { url, init } of a.requests) {
    assert.equal(url, '/api/admin/catalog-examples/existing%2Fexample/complete');
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
    assert.equal(init.body, undefined); assert.equal(init.cache, 'no-store');
  }
});

test('persistent transport failures, malformed JSON and non-JSON gateway responses stop after three attempts', async () => {
  for (const failure of [new Error('network abort'), unavailable, () => new Response('{'),
    () => new Response('<html>Gateway timeout</html>', { status: 504 }),
    () => Response.json({ ok: true })]) {
    const a = await check([failure]);
    assert.equal(a.requests.length, 3); assert.equal(a.result.status, 'pending');
    assert.match(a.result.message, /do not need to upload/);
  }
});

test('401 and 403 stop immediately even with a retryable body; processing failures also stop', async () => {
  for (const status of [401, 403, 404, 409, 422]) {
    const a = await check([() => Response.json({ error: 'Denied', retryable: true }, { status }), ready]);
    assert.equal(a.requests.length, 1);
    assert.equal(a.result.status, status === 401 || status === 403 ? 'blocked' : 'failed');
  }
});

test('processing and rate-limit checks recover; polling is bounded by count and elapsed time', async () => {
  const recovered = await check([processing, () => new Response(null, { status: 429 }), ready]);
  assert.equal(recovered.result.status, 'ready');
  const exhausted = await check([processing]);
  assert.equal(exhausted.requests.length, 40); assert.equal(exhausted.result.status, 'pending');
  assert.match(exhausted.result.message, /still processing/);
  const slow = await check([processing], { fetchDelay: 15_000 });
  assert.equal(slow.result.status, 'pending'); assert.ok(slow.requests.length < 10);
  // This immediate fake advances wall time without firing real timeout signals;
  // no further request or sleep may start once it crosses the deadline.
  assert.equal(slow.requests.length, 7); assert.equal(slow.clock, 123_000);
});

test('abort before, during a request, or between polls prevents stale readiness and further requests', async () => {
  const before = new AbortController(); before.abort();
  assert.equal((await check([ready], { controller: before })).requests.length, 0);
  const during = new AbortController();
  const a = await check([() => { during.abort(); return ready(); }], { controller: during });
  assert.equal(a.result.status, 'cancelled'); assert.equal(a.requests.length, 1);
  const between = new AbortController();
  const b = await check([processing], { controller: between, sleep: async () => between.abort() });
  assert.equal(b.result.status, 'cancelled'); assert.equal(b.requests.length, 1);
});

test('closing also cancels the real retry timer promptly', async () => {
  const controller = new AbortController(); let requests = 0;
  const result = await waitForCatalogVideoCompletion('existing-example', {
    signal: controller.signal,
    fetchImpl: async () => { requests++; return unavailable(); },
    onPending: () => { setTimeout(() => controller.abort(), 0); },
  });
  assert.equal(result.status, 'cancelled'); assert.equal(requests, 1);
});
