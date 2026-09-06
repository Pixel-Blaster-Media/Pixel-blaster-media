import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
function load(file, mocks) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'exports', source)((name) => {
    if (name in mocks) return mocks[name];
    if (name === 'server-only') return {};
    if (name.startsWith('@/')) return load(resolve(root, name.slice(2) + '.ts'), mocks);
    return require(name);
  }, exports);
  return exports;
}
const org = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
function fixture() {
  const effects = []; const inbox = []; const challenges = new Map();
  let existing = false;
  const profile = { id: 'user-1', email: 'controlled@example.test', organization_id: org, role: 'realtor', archived_at: null };
  const service = {
    auth: { getUser: async () => ({ data: { user: profile }, error: null }) },
    from(table) {
      const query = { select() { return query; }, eq() { return query; }, in() { return query; }, limit() { return query; },
        maybeSingle: async () => ({ data: table === 'profiles' ? profile : null, error: null }),
        update() { effects.push('profile'); return query; }, then(resolve) { resolve({ data: null, error: null }); } };
      return query;
    },
    async rpc(name, args) {
      if (name === 'begin_public_booking_verification') {
        const prior = challenges.get(args.p_request_id);
        if (prior) return { data: false, error: null };
        challenges.set(args.p_request_id, args); return { data: true, error: null };
      }
      if (name === 'verify_public_booking_inbox') {
        const row = challenges.get(args.p_request_id);
        const valid = row && row.p_organization_id === args.p_organization_id && row.p_email === args.p_email && row.p_fingerprint === args.p_fingerprint && row.p_code_hash === args.p_code_hash;
        if (valid) effects.push('proof');
        return { data: !!valid, error: null };
      }
      assert.equal(name, 'create_public_booking_with_jobs'); effects.push('booking');
      return { data: { booking_id: 'booking-1', property_id: 'property-1', scheduled_ends_at: '2027-01-10T17:00:00Z' }, error: null };
    },
  };
  const mocks = {
    'next/navigation': { redirect: (url) => { throw new Error('REDIRECT:' + url); } },
    '@/lib/auth/email-lookup': { emailHasAccount: async () => existing },
    '@/lib/auth/provision-realtor': { provisionRealtorAuthUser: async () => { effects.push('identity'); existing = true; return { ok: true, userId: profile.id, provisioningId: 'provision-1' }; } },
    '@/lib/auth/rollback-provisioned-realtor': { rollbackProvisionedRealtor: async () => { effects.push('rollback'); return { status: 'deleted' }; } },
    '@/lib/auth/set-session-cookie': { signInWithPasswordREST: async () => { effects.push('password'); return { ok: true, tokens: { access_token: 'fake', refresh_token: 'fake' } }; }, setSupabaseSessionCookie: async () => { effects.push('cookie'); } },
    '@/lib/booking/availability': { BUSINESS_TZ: 'America/Toronto', isSlotAvailable: async () => true },
    '@/lib/booking/catalog': { getActiveCatalog: async () => ({ bundles: [{ id: 'catalog-1', slug: 'blue-print', name: 'Blue Print', kind: 'bundle', duration_minutes: 60 }], addons: [], aLaCarte: [] }) },
    '@/lib/booking/catalog-rules': { isAddonEligible: () => true },
    '@/lib/booking/manage-token': { createManageToken: () => 'fake-manage' },
    '@/lib/email/settings': { getAdminNotificationEmail: async () => null },
    '@/lib/email/resend': { sendEmail: async (message) => { inbox.push(message); return { ok: true, id: 'fake-email' }; } },
    '@/lib/integrations/dispatcher': { dispatchBookingIntegrationJobs: async () => { effects.push('dispatch'); } },
    '@/lib/integrations/dispatcher-core': { buildIntegrationWorkerId: () => 'worker' },
    '@/lib/organizations/public-booking': { resolvePublicBookingOrganization: async () => ({ id: org, name: 'Controlled company' }) },
    '@/lib/supabase/server': { getServiceSupabase: () => service, getServerSupabase: async () => ({ auth: { getUser: async (token) => token ? { data: { user: profile }, error: null } : { data: { user: null }, error: { name: 'AuthSessionMissingError' } } } }) },
  };
  const action = load(resolve(root, 'app/book/actions.ts'), mocks).createPublicBooking;
  const form = new FormData();
  for (const [key, value] of Object.entries({ public_request_id: requestId, services: 'blue-print', slot: '2027-01-10T16:00:00Z', street_address: '1 Fictional Street', contact_name: 'Controlled Test', contact_email: profile.email, contact_phone: '555-0100', password: 'controlled-password' })) form.set(key, value);
  return { action, form, effects, inbox, mocks };
}
test('unused email must prove its inbox before identity, session, or booking effects', async () => {
  const f = fixture();
  const result = await f.action(null, f.form);
  assert.equal(result.ok, false);
  assert.equal(result.verificationRequired, true);
  assert.equal(f.inbox.length, 1);
  assert.deepEqual(f.effects, []);
  assert.doesNotMatch(JSON.stringify(result), /controlled-password|\d{8}/);
});
test('controlled inbox code continues the retained request through booking and portal', async () => {
  const f = fixture();
  await f.action(null, f.form);
  const code = f.inbox[0].text.match(/\b\d{8}\b/)[0];
  f.form.set('verification_code', code);
  await assert.rejects(f.action(null, f.form), /REDIRECT:\/portal\/property-1\?booked=1/);
  assert.deepEqual(f.effects, ['proof', 'identity', 'profile', 'password', 'booking', 'cookie', 'dispatch']);
  assert.equal(f.inbox.length, 1);
});
test('framework action metadata does not change the retained booking fingerprint', () => {
  const f=fixture();
  const {publicBookingFingerprint}=load(resolve(root,'lib/auth/public-booking-verification.ts'),f.mocks);
  const before=publicBookingFingerprint(f.form);
  f.form.set('$ACTION_REF_0',''); f.form.set('$ACTION_0:0','rotating action state');
  assert.equal(publicBookingFingerprint(f.form),before);
});
test('verification infrastructure failure returns a safe result with no consequential effects', async()=>{
  const f=fixture();
  const {requirePublicBookingInbox}=load(resolve(root,'lib/auth/public-booking-verification.ts'),{...f.mocks,'@/lib/supabase/server':{getServiceSupabase(){throw new Error('private infrastructure detail');}}});
  const result=await requirePublicBookingInbox({requestId, organizationId:org,email:'controlled@example.test',fingerprint:'a'.repeat(64),code:''});
  assert.equal(result.ok,false); assert.doesNotMatch(JSON.stringify(result),/private infrastructure/);
});
for (const mutation of ['wrong-code','changed-email','changed-notes','rpc-error','skipped-email']) test(`public action fails closed: ${mutation}`,async()=>{
  const f=fixture();
  if(mutation==='skipped-email') f.mocks['@/lib/email/resend'].sendEmail=async()=>({ok:true,skipped:true});
  if(mutation==='rpc-error') f.mocks['@/lib/supabase/server'].getServiceSupabase().rpc=async()=>({data:null,error:{code:'unavailable'}});
  const first=await f.action(null,f.form);
  assert.equal(first.ok,false); assert.deepEqual(f.effects,[]);
  if(mutation==='skipped-email'||mutation==='rpc-error') {assert.ok(first.errors._form);return;}
  f.form.set('verification_code',f.inbox[0].text.match(/\b\d{8}\b/)[0]);
  if(mutation==='wrong-code') f.form.set('verification_code','not-a-code');
  if(mutation==='changed-email') f.form.set('contact_email','other@example.test');
  if(mutation==='changed-notes') f.form.set('notes','changed private instructions');
  const second=await f.action(null,f.form); assert.equal(second.ok,false); assert.deepEqual(f.effects,[]);
});
export { fixture, load, root };
