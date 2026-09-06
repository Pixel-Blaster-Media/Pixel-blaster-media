import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createQBOTransport, QBOError } = require('../transport.ts');

test('unknown, duplicate, mixed and malformed faults never prove rejection', async () => {
  for (const errors of [[{code:'99999'}], [{code:'600'}], [{code:'2020'}, {code:'99999'}], [null]]) {
    const server = createServer((req, res) => { res.end(JSON.stringify({Fault:{type:'ValidationFault', Error:errors}})); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const request = createQBOTransport({base:`http://127.0.0.1:${server.address().port}`, realmId:'123', accessToken:'test'});
      await assert.rejects(request('/invoice', {method:'POST',body:{}}), err => err instanceof QBOError && err.outcome === 'unknown');
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});

test('real HTTP transport preserves requestid and treats HTTP 200 Fault as rejected', async () => {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, body: JSON.parse(body) });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ Fault: { type: 'ValidationFault', Error: [{ code: '2020', Message: 'private details' }] } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const request = createQBOTransport({ base: `http://127.0.0.1:${server.address().port}`, realmId: '123', accessToken: 'test-only' });
    await assert.rejects(request('/invoice', { method: 'POST', body: { Line: [] }, query: { requestid: 'durable-uuid' } }), err => err instanceof QBOError && err.outcome === 'rejected' && !err.message.includes('private details'));
    assert.equal(new URL(requests[0].url, 'http://local').searchParams.get('requestid'), 'durable-uuid');
    assert.deepEqual(requests[0].body, { Line: [] });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
