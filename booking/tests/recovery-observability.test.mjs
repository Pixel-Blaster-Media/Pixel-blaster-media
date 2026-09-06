import test from 'node:test';
import assert from 'node:assert/strict';

const tenant = '11111111-1111-4111-8111-111111111111';
const now = Date.parse('2026-09-06T12:00:00Z');
const request = (token = 'secret', organizationId = tenant) => new Request(`https://example.test/api/cron/recovery-status?organizationId=${organizationId}`, {headers: {authorization: `Bearer ${token}`}});

test('authenticated tenant telemetry is bounded, ages unresolved work, and never calls unknown empty', async () => {
  const module = await import('../lib/integrations/recovery-status.ts').catch(() => ({}));
  assert.equal(typeof module.recoveryStatus, 'function', 'recovery status handler must exist');
  const { recoveryStatus } = module;
  let calls = [];
  let result = {data: [{created_at: '2026-09-05T12:00:00Z'}], count: 4, error: null};
  const client = {from(table) {
    const call = {table}; calls.push(call);
    const query = {
      select(columns, options) {call.columns = columns; call.options = options; return query;},
      eq(key, value) {call.tenant = [key, value]; return query;},
      in(key, values) {call.states = [key, values]; return query;},
      order(key, options) {call.order = [key, options]; return query;},
      limit(value) {call.limit = value; return query;},
      abortSignal(signal) {call.signal = signal; return Promise.resolve(result);},
    }; return query;
  }};
  const run = (req = request(), secret = 'secret', load = () => client) => recoveryStatus(req, secret, load, now);
  assert.equal((await run(request('wrong'))).status, 401);
  assert.equal((await recoveryStatus(request(), undefined, () => client, now)).status, 503);
  assert.equal((await run(request('secret', 'bad'))).status, 400);
  assert.equal(calls.length, 0);
  const response = await run();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.status, 200);
  const body = await response.json();
  for (const metric of Object.values(body.metrics)) assert.deepEqual(metric, {status:'known', count:4, oldestAgeSeconds:86400});
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.deepEqual(call.tenant, ['organization_id', tenant]);
    assert.equal(call.columns, 'created_at');
    assert.deepEqual(call.options, {count:'exact'});
    assert.equal(call.limit, 1);
    assert.deepEqual(call.order, ['created_at', {ascending:true}]);
    assert.ok(call.signal instanceof AbortSignal);
  }
  assert.deepEqual(calls.map(c => [c.table, c.states]), [
    ['integration_jobs', ['status', ['pending','retryable','processing']]],
    ['integration_jobs', ['status', ['dead_letter']]],
    ['autoenhance_batches', ['status', ['processing','waiting_for_iguide','attention']]],
  ]);
  result = {data:[], count:0, error:null};
  assert.deepEqual((await (await run()).json()).metrics.mediaUnresolved, {status:'known', count:0, oldestAgeSeconds:null});
  for (const bad of [
    {data:null,count:null,error:{message:'provider-secret'}},
    {data:[],count:null,error:null},
    {data:[],count:1,error:null},
    {data:[{created_at:'invalid'}],count:1,error:null},
    {data:[{created_at:'2027-01-01'}],count:1,error:null},
  ]) {
    result = bad;
    const failed = await run(); assert.equal(failed.status, 503);
    const text = await failed.text(); assert.ok(!text.includes('provider-secret'));
    assert.deepEqual(JSON.parse(text).metrics.mediaUnresolved, {status:'unknown',count:null,oldestAgeSeconds:null});
  }
  const failed = await run(request(), 'secret', () => {throw new Error('provider-secret');});
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes('provider-secret'));
});
