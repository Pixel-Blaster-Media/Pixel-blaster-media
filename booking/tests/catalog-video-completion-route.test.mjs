import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource, resultQuery } from './helpers/source-module.mjs';

const { resolveVerifiedIdentity } = loadSource('lib/auth/request-verified-identity-core.ts', {
  react: { cache: fn => fn }, './session-error.ts': loadSource('lib/auth/session-error.ts'),
});
const { createBoundedSupabaseAuthFetch } = loadSource('lib/auth/bounded-supabase-auth-fetch.ts', {}, {
  AbortController, Request, Response, Headers, setTimeout, clearTimeout,
});
const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const active = { kind: 'active', profile: { userId: 'admin', organizationId: org,
  archivedAt: null, role: 'admin', email: 'admin@example.invalid', fullName: null },
  verifiedIdentity: { id: 'admin' } };

function fixture({ identities = [active], membership = { organization_id: org, role: 'admin' },
  membershipError = null, lookupError = null, rpcError = null, providerError = false,
  state = 'ready', status = 'uploading', foreign = false, committedButErrorOnce = false } = {}) {
  const calls = [], membershipFilters = [], redirects = [];
  let authCalls = 0;
  const row = { id: 'example', stream_uid: 'a'.repeat(32), status,
    organization_id: foreign ? 'another-company' : org, source_type: 'cloudflare_stream' };
  const guard = loadSource('lib/auth/require-admin.ts', {
    react: { cache: fn => fn }, 'next/headers': { headers: async () => new Headers() },
    'next/navigation': { redirect: destination => { redirects.push(destination); throw Error('PAGE_REDIRECT'); } },
    '@/lib/auth/admin-action-context': { getVerifiedAdminActionContext: () => null },
    '@/lib/auth/current-user': { getCurrentUserResult: async () => {
      const value = identities[Math.min(authCalls++, identities.length - 1)];
      return typeof value === 'function' ? value() : value;
    } },
    '@/lib/supabase/server': { getServerSupabase: async () => ({ from: table => {
      assert.equal(table, 'organization_members');
      return resultQuery({ data: membership, error: membershipError }, membershipFilters);
    } }) },
  });
  const db = { from(table) {
    calls.push(['read', table]); const filters = [];
    const q = { select() { return q; }, eq(k, v) { filters.push([k, v]); return q; },
      async maybeSingle() { calls.push(['filters', filters]);
        return { data: filters.every(([k, v]) => row[k] === v) ? row : null, error: lookupError }; } };
    return q;
  }, async rpc(name, args) {
    assert.ok(['finalize_catalog_stream_upload_with_dimensions', 'record_catalog_stream_example_dimensions',
      'finalize_catalog_stream_upload'].includes(name));
    calls.push(['rpc', name, args]);
    if (committedButErrorOnce) {
      committedButErrorOnce = false; row.status = 'ready';
      return { data: null, error: { message: 'Response lost after commit' } };
    }
    if (!rpcError) row.status = args.p_outcome ?? 'ready';
    return { data: !rpcError, error: rpcError };
  } };
  const route = loadSource('app/api/admin/catalog-examples/[id]/complete/route.ts', {
    'next/server': { NextResponse: Response }, 'next/cache': { revalidatePath: path => calls.push(['revalidate', path]) },
    '@/lib/auth/require-admin': guard,
    '@/lib/supabase/server': { getServiceSupabase: () => db },
    '@/lib/booking/catalog-examples-core': { getStreamVideoDetails: async () => {
      calls.push(['provider']); if (providerError) throw Error('Provider unavailable');
      return { state, width: 2160, height: 3840 };
    } },
  });
  return { calls, row, membershipFilters, redirects, guard,
    post: () => route.POST(new Request('https://example.invalid/complete', { method: 'POST' }),
      { params: Promise.resolve({ id: row.id }) }) };
}

test('actual bounded auth abort returns structured retryable 503 before any provider or example access, then safely recovers', async () => {
  const authFetch = createBoundedSupabaseAuthFetch('https://auth.example.invalid',
    () => new Promise(() => {}), { timeoutMs: 1 });
  const unavailable = () => resolveVerifiedIdentity(async () => {
    await authFetch('https://auth.example.invalid/auth/v1/user');
    throw Error('Aborted auth must not succeed');
  });
  const a = fixture({ identities: [unavailable, active] });
  const denied = await a.post();
  assert.equal(denied.status, 503); assert.equal(denied.headers.get('retry-after'), '3');
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  assert.equal(denied.headers.get('referrer-policy'), 'no-referrer');
  const body = await denied.json();
  assert.equal(body.retryable, true); assert.equal(body.code, 'authentication_unavailable');
  assert.equal(body.status, 'verification_pending');
  assert.equal(a.calls.length, 0); assert.equal(a.membershipFilters.length, 0); assert.equal(a.redirects.length, 0);
  assert.equal((await a.post()).status, 200); assert.equal(a.row.status, 'ready');
  assert.equal((await a.post()).status, 200);
  assert.deepEqual(a.calls.filter(c => c[0] === 'rpc').map(c => c[1]),
    ['finalize_catalog_stream_upload_with_dimensions', 'record_catalog_stream_example_dimensions']);
  assert.deepEqual(a.calls.find(c => c[0] === 'filters')[1],
    [['id', 'example'], ['organization_id', org], ['source_type', 'cloudflare_stream']]);
  assert.ok(a.membershipFilters.some(c => c[0] === 'in' && c[1] === 'role' && c[2].join(',') === 'owner,admin'));
});

test('missing/invalid sessions and true permission denials are terminal with no provider or finalization access', async () => {
  for (const kind of ['missing', 'invalid', 'no_workspace']) {
    const a = fixture({ identities: [{ kind }] }); const response = await a.post();
    assert.equal(response.status, kind === 'no_workspace' ? 403 : 401);
    assert.equal((await response.json()).retryable, false); assert.equal(a.calls.length, 0);
    assert.equal(a.redirects.length, 0);
  }
  for (const settings of [{ membership: null }, { identities: [{ ...active, profile: { ...active.profile, archivedAt: '2026-01-01' } }] }]) {
    const a = fixture(settings); assert.equal((await a.post()).status, 403); assert.equal(a.calls.length, 0);
  }
});

test('page guards retain their existing redirects; a membership outage still fails closed', async () => {
  const page = fixture({ identities: [{ kind: 'unavailable' }] });
  await assert.rejects(page.guard.requireAdmin(), /PAGE_REDIRECT/);
  assert.deepEqual(page.redirects, ['/auth/access-unavailable']);
  const a = fixture({ membershipError: { code: 'unavailable' } });
  const response = await a.post(); assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'authentication_unavailable'); assert.equal(a.calls.length, 0);
});

test('foreign examples stay inaccessible; temporary reads, provider checks and idempotent finalization failures stay retryable', async () => {
  const foreign = fixture({ foreign: true }); assert.equal((await foreign.post()).status, 404);
  assert.equal(foreign.calls.some(c => ['rpc', 'provider'].includes(c[0])), false);
  for (const settings of [{ lookupError: {} }, { providerError: true }, { rpcError: {} }]) {
    const a = fixture(settings); const response = await a.post();
    assert.equal(response.status, 503); assert.equal((await response.json()).retryable, true);
  }
  const failed = fixture({ state: 'failed' }); assert.equal((await failed.post()).status, 422);
  const processing = fixture({ state: 'processing' }); assert.equal((await processing.post()).status, 202);
  assert.equal(processing.calls.some(c => c[0] === 'rpc'), false);
});

test('a lost finalization response recovers the already-ready example without creating or uploading another video', async () => {
  const a = fixture({ committedButErrorOnce: true });
  const first = await a.post(); assert.equal(first.status, 503); assert.equal(a.row.status, 'ready');
  const recovered = await a.post(); assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).status, 'ready');
  assert.deepEqual(a.calls.filter(c => c[0] === 'rpc').map(c => c[1]),
    ['finalize_catalog_stream_upload_with_dimensions', 'record_catalog_stream_example_dimensions']);
});
