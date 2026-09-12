import assert from 'node:assert/strict';
import test from 'node:test';

const moduleUrl = new URL('../lib/media/finals/config.ts', import.meta.url);
const scope = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  bookingId: '22222222-2222-4222-8222-222222222222',
  propertyId: '33333333-3333-4333-8333-333333333333',
};
const env = () => ({
  PHOTO_FINALS_ENABLED: 'true',
  PHOTO_FINALS_ENVIRONMENT: 'production',
  VERCEL_ENV: 'production',
  PHOTO_FINALS_ALLOWED_SCOPES: JSON.stringify([scope]),
});

test('finished JPEG deployment eligibility defaults closed without resolving storage', async () => {
  const { photoFinalsEligibility } = await import(moduleUrl);
  assert.deepEqual(photoFinalsEligibility({}, scope), { eligible: false, reason: 'disabled' });
  assert.deepEqual(photoFinalsEligibility(env(), scope), { eligible: true, environment: 'production' });
});

test('literal enablement, environment separation and exact tuple allowlists fail closed', async () => {
  const { photoFinalsEligibility } = await import(moduleUrl);
  for (const value of [undefined, 'TRUE', '1', ' true', 'false']) {
    assert.equal(photoFinalsEligibility({ ...env(), PHOTO_FINALS_ENABLED: value }, scope).eligible, false);
  }
  for (const deployment of [undefined, 'preview', 'development']) {
    assert.equal(photoFinalsEligibility({ ...env(), VERCEL_ENV: deployment }, scope).eligible, false);
  }
  assert.equal(photoFinalsEligibility({ ...env(), PHOTO_FINALS_ENVIRONMENT: 'development' }, scope).eligible, false);
  const other = { ...scope, bookingId: '44444444-4444-4444-8444-444444444444' };
  assert.equal(photoFinalsEligibility(env(), other).eligible, false);
  // Independent organization and booking lists would wrongly permit this cross product.
  const second = { ...other, organizationId: '55555555-5555-4555-8555-555555555555' };
  assert.equal(photoFinalsEligibility({ ...env(), PHOTO_FINALS_ALLOWED_SCOPES: JSON.stringify([scope, second]) }, other).eligible, false);
  for (const list of ['*', 'null', '{}', '[]', JSON.stringify([{ ...scope, propertyId: '*' }]), JSON.stringify([scope, scope]), JSON.stringify([{ ...scope, typo: true }]), ' '.repeat(65537)]) {
    assert.equal(photoFinalsEligibility({ ...env(), PHOTO_FINALS_ALLOWED_SCOPES: list }, scope).eligible, false);
  }
});

test('synthetic eligibility is local-only and cannot reuse production switch', async () => {
  const { photoFinalsEligibility } = await import(moduleUrl);
  const local = { ...env(), VERCEL_ENV: undefined, NODE_ENV: 'test', PHOTO_FINALS_ENVIRONMENT: 'synthetic-local', PHOTO_FINALS_SYNTHETIC_ACK: 'isolated-no-network' };
  assert.deepEqual(photoFinalsEligibility(local, scope), { eligible: true, environment: 'synthetic-local' });
  for (const change of [{ VERCEL_ENV: 'production' }, { VERCEL_ENV: 'preview' }, { NODE_ENV: 'production' }, { PHOTO_FINALS_SYNTHETIC_ACK: '' }]) {
    assert.equal(photoFinalsEligibility({ ...local, ...change }, scope).eligible, false);
  }
  assert.equal(photoFinalsEligibility(env(), { ...scope, organizationId: scope.organizationId.toUpperCase() + ' ' }).eligible, false);
});
