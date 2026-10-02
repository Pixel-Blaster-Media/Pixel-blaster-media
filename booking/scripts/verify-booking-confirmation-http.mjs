import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, createDecipheriv } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Executes the REAL built Next action/RSC/browser path. Only the external
// Supabase transport is synthetic; no production account or provider is used.
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:54329');
assert.equal(process.env.SUPABASE_SERVICE_ROLE_KEY, 'ci-service-role-key');
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'ci-anon-key');
assert.ok(existsSync('.next/BUILD_ID'), 'build first');
const { chromium } = await import(process.env.BOOKING_PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.BOOKING_PLAYWRIGHT_MODULE)).href : 'playwright');
const evidenceDir = process.env.BOOKING_EVIDENCE_DIR;
if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
const org = '00000000-0000-0000-0000-000000000001';
const actor = '00000000-0000-4000-8000-000000000011';
const itemId = '00000000-0000-4000-8000-000000000101';
const bookingId = '00000000-0000-4000-8000-000000000201';
const propertyId = '00000000-0000-4000-8000-000000000301';
const secret = 'ci-booking-manage-secret';
const profile = { id: actor, organization_id: org, email: 'synthetic@example.invalid', full_name: 'Synthetic Realtor', phone: '555-0100', brokerage: 'Synthetic', role: 'realtor', archived_at: null };
const organization = { id: org, name: 'Synthetic Booking QA', slug: 'pixelblastermedia', invoice_timing: 'on_delivery', admin_notification_email: null };
const item = { id: itemId, organization_id: org, active: true, name: 'Video Tour', slug: 'video_tour', kind: 'a_la_carte', description: 'Synthetic video', price_cents: 32500, duration_minutes: 60, display_order: 1, is_video: true, is_photo: false, is_iguide: false, is_aerial: false, require_has_video: false, require_has_media: false, require_has_iguide: false, exclude_has_aerial: false, sqft_pricing_enabled: false, video_overage_threshold_sqft: 2500, video_overage_price_cents: 5000, includes: [], highlights: [], media_badges: [] };
const timestamp = new Date().toISOString();
const user = { id: actor, aud: 'authenticated', role: 'authenticated', email: profile.email, email_confirmed_at: timestamp, confirmed_at: timestamp, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], created_at: timestamp, updated_at: timestamp };
const b64 = object => Buffer.from(JSON.stringify(object)).toString('base64url');
const expires = Math.floor(Date.now()/1000)+3600;
const session = { access_token: `${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:actor,email:profile.email,aud:'authenticated',role:'authenticated',exp:expires,iat:expires-3600})}.synthetic-signature`, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expires, user };
const committed = new Map();
let atomicCalls = 0, durableEffects = 0, passwordCalls = 0;
const unexpected = [], pageErrors = [];
const json = (response,status,data) => { response.writeHead(status, {'content-type':'application/json'}); response.end(JSON.stringify(data)); };
const transport = http.createServer(async (request,response) => {
  try {
    const url = new URL(request.url,'http://127.0.0.1:54329');
    if(process.env.BOOKING_PROBE_DEBUG==='1')console.log('fixture',request.method,url.pathname);
    const table = url.pathname.split('/').pop();
    if (request.method === 'POST' && url.pathname === '/auth/v1/token') { passwordCalls++; return json(response,200,session); }
    if (request.method === 'GET' && url.pathname === '/auth/v1/user') return json(response,200,user);
    if (request.method === 'GET' && table === 'organizations') return json(response,200,organization);
    if (request.method === 'GET' && table === 'profiles') return json(response,200,profile);
    if (request.method === 'GET' && table === 'organization_members') return json(response,200,url.searchParams.has('role') ? null : {organization_id:org,profile_id:actor,role:'member'});
    if (request.method === 'GET' && table === 'catalog_items') return json(response,200,[item]);
    if (request.method === 'GET' && table === 'business_hours') return json(response,200,Array.from({length:7},(_,day_of_week)=>({day_of_week,start_time:'09:00:00',end_time:'17:00:00',enabled:true})));
    if (request.method === 'GET' && ['catalog_item_examples','catalog_item_example_placements','calendar_blocks','google_calendar_connection'].includes(table)) return json(response,200,[]);
    if (request.method === 'GET' && table === 'properties') {
      assert.equal(url.searchParams.get('id'),`eq.${propertyId}`);
      assert.equal(url.searchParams.get('organization_id'),`eq.${org}`);
      assert.equal(url.searchParams.get('owner_id'),`eq.${actor}`);
      return json(response,200,{street_address:'456 Private Rebook Street',city:'Hamilton',postal_code:'L8P 4S8'});
    }
    if (request.method === 'GET' && table === 'bookings') {
      if (url.searchParams.has('property_id')) {
        assert.equal(url.searchParams.get('property_id'),`eq.${propertyId}`);
        assert.equal(url.searchParams.get('organization_id'),`eq.${org}`);
        assert.equal(url.searchParams.get('owner_id'),`eq.${actor}`);
        assert.equal(url.searchParams.get('id'),`eq.${bookingId}`);
        return json(response,200,{id:bookingId,services:['video_tour'],add_ons:[],square_footage:2400,unit_number:'4B'});
      }
      if (url.searchParams.has('public_request_id')) return json(response,200,committed.has(url.searchParams.get('public_request_id').slice(3)) ? {id:bookingId} : null);
      if (url.searchParams.has('id')) return json(response,200,{id:bookingId,organization_id:org,suppress_realtor_notifications:false});
      return json(response,200,[]);
    }
    if (request.method === 'GET' && table === 'booking_line_items') return json(response,200,[{catalog_item_id:itemId,item_name:item.name,item_slug:item.slug,item_kind:item.kind,unit_duration_minutes:60}]);
    if (request.method === 'POST' && url.pathname.startsWith('/rest/v1/rpc/')) {
      let body=''; for await (const chunk of request) body += chunk;
      const args=JSON.parse(body);
      if (table === 'create_public_booking_with_jobs' || table === 'create_public_booking_with_jobs_v2') {
        assert.equal(args.p_organization_id,org); assert.equal(args.p_owner_id,actor);
        assert.equal(table,'create_public_booking_with_jobs_v2');assert.equal(args.p_quote_policy_version,'2026-09-30-v1');
        atomicCalls++;
        const prior=committed.get(args.p_request_id);
        if (prior) assert.deepEqual(args,prior,'duplicate POST must preserve request identity and payload');
        else {committed.set(args.p_request_id,args);durableEffects++;}
        return json(response,200,{booking_id:bookingId,property_id:propertyId,scheduled_ends_at:new Date(Date.parse(args.p_scheduled_at)+75*60000).toISOString(),replayed:!!prior});
      }
      // No provider job is ever returned for dispatch.
      if (table === 'claim_integration_job') return json(response,200,[]);
    }
    unexpected.push(`${request.method} ${url.pathname}`);
    return json(response,500,{error:'Unmodeled synthetic transport request'});
  } catch(error) { unexpected.push(String(error));return json(response,500,{error:'Synthetic fixture assertion failed'}); }
});
await new Promise((resolve,reject)=>{transport.once('error',reject);transport.listen(54329,'127.0.0.1',resolve);});
const reservation=http.createServer();
await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
const appPort=reservation.address().port;
await new Promise(resolve=>reservation.close(resolve));
const origin=`http://127.0.0.1:${appPort}`;
let serverLog='';
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(appPort)],{env:{PATH:process.env.PATH,NODE_ENV:'production',VERCEL_ENV:'preview',NEXT_PUBLIC_APP_URL:origin,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54329',NEXT_PUBLIC_SUPABASE_ANON_KEY:'ci-anon-key',SUPABASE_SERVICE_ROLE_KEY:'ci-service-role-key',BOOKING_MANAGE_SECRET:secret,CRON_SECRET:'ci-cron-secret',AUTH_RECOVERY_SECRET:'ci-recovery-secret',BOOKING_PROXY_SHARED_SECRET:'ci-only-proxy-attestation-secret-0123456789abcdef',PUBLIC_AI_RECOMMENDATIONS_ENABLED:'0'},stdio:['ignore','pipe','pipe']});
child.stdout.on('data',chunk=>{serverLog+=chunk;if(process.env.BOOKING_PROBE_DEBUG==='1')process.stdout.write(chunk);});child.stderr.on('data',chunk=>{serverLog+=chunk;if(process.env.BOOKING_PROBE_DEBUG==='1')process.stderr.write(chunk);});
let browser;
try {
  const deadline=Date.now()+15000;
  while (true) {
    try { const response=await fetch(`${origin}/book?org=pixelblastermedia`,{signal:AbortSignal.timeout(1500)});if(response.ok){await response.body?.cancel();break;} }catch{}
    assert.ok(Date.now()<deadline,`local Next did not start: ${serverLog}`);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  browser=await chromium.launch({headless:true,timeout:15000,...(process.env.BOOKING_CHROME_PATH?{executablePath:process.env.BOOKING_CHROME_PATH}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addCookies([{name:'sb-127-auth-token',value:`base64-${b64(session)}`,url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin ? route.continue() : route.abort());
  const page=await context.newPage();page.setDefaultTimeout(12000);
  page.on('pageerror',error=>pageErrors.push(error.message));
  let submitted;
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/book/confirm')submitted={url:request.url(),headers:request.headers(),body:request.postDataBuffer()};});
  // Exercise the authenticated portal's REAL POST -> encrypted cookie -> wizard.
  await page.goto(`${origin}/portal/book?from_property=${propertyId}&from_booking=${bookingId}&address=OLD-URL-PRIVATE&shoot_notes=OLD-URL-SECRET`);
  await page.waitForURL(url=>url.pathname==='/portal/book'&&!url.searchParams.has('address'));
  assert.ok(!page.url().includes('OLD-URL'));
  assert.ok(!(await page.content()).includes('456 Private Rebook Street'));
  await page.getByRole('button',{name:'Book similar shoot',exact:true}).click();
  await page.waitForURL(/\/book\/property/);
  const rebookUrl = new URL(page.url());
  assert.deepEqual([...rebookUrl.searchParams.keys()].sort(),['draft','org','services']);
  assert.equal(await page.locator('input[name="address"]').inputValue(),'456 Private Rebook Street');
  assert.equal(await page.locator('input[name="sqft"]').inputValue(),'2400');
  await page.reload();
  assert.equal(await page.locator('input[name="address"]').inputValue(),'456 Private Rebook Street');
  assert.equal(committed.size,0,'a rebooking draft must not reserve an appointment');
  if(evidenceDir)await page.screenshot({path:resolve(evidenceDir,'private-portal-rebook.png'),fullPage:true});
  for (let index=0; index<5; index++) {
    await page.goBack();
    await page.waitForURL(/\/portal\/book/);
    await page.getByRole('button',{name:'Book similar shoot',exact:true}).click();
    await page.waitForURL(/\/book\/property/);
    const drafts=(await context.cookies()).filter(cookie=>cookie.name.startsWith('pb_booking_draft_'));
    if (process.env.EXPECT_REBOOK_GROWTH!=='1') assert.ok(drafts.length<=2,`rebook cookies must stay bounded; got ${drafts.length}`);
  }
  if (process.env.EXPECT_REBOOK_GROWTH==='1') {
    const count=(await context.cookies()).filter(cookie=>cookie.name.startsWith('pb_booking_draft_')).length;
    assert.ok(count>2); console.log(JSON.stringify({reproduced:true,repeatedRebookCookieCount:count}));
  }
  // Exercise an anonymous existing-account customer, including the session
  // cookie installation that causes Next to rerender after the commit.
  await context.clearCookies({name:'sb-127-auth-token'});
  await page.goto(`${origin}/book/property?org=pixelblastermedia&services=video_tour`);
  await page.locator('input[name="address"]').fill('123 Synthetic Receipt Street');
  await page.locator('input[name="city"]').fill('Hamilton');
  await page.locator('input[name="sqft"]').fill('2501');
  await page.getByText('Yes, shoot the basement',{exact:true}).click();
  await page.locator('summary').filter({hasText:'Optional shot requests'}).click();
  await page.getByRole('textbox',{name:'Specific shot notes (optional)'}).fill('PRIVATE-ACCESS-SENTINEL');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.waitForURL(/\/book\/schedule/);
  const draftId=new URL(page.url()).searchParams.get('draft');
  await page.getByRole('button',{name:/— \d+ available times?/}).first().click();
  await page.getByRole('button',{name:/ at .*\(America\/Toronto\)/}).first().click();
  await page.waitForURL(/\/book\/confirm/);
  await page.getByRole('heading',{name:'Review + confirm'}).waitFor();
  const fillContact = async () => {
    await page.locator('input[name="contact_name"]').fill(profile.full_name);
    await page.locator('input[name="contact_phone"]').fill(profile.phone);
    await page.locator('input[name="contact_email"]').fill(profile.email);
    await page.locator('input[name="password"]').fill('synthetic-password');
  };
  await fillContact();
  if(process.env.EXPECT_RECEIPT_LOSS!=='1' && process.env.EXPECT_EXPIRED_RECEIPT_LOSS!=='1') {
    await page.locator('input[name="quote_policy_version"]').evaluate(input=>input.remove());
    await page.getByRole('button',{name:'Confirm booking',exact:true}).click();
    await page.getByText('Booking prices and timing changed. Refresh and review your quote before confirming.',{exact:true}).waitFor();
    assert.equal(atomicCalls,0);assert.equal(committed.size,0);assert.equal(durableEffects,0);
    if(evidenceDir)await page.screenshot({path:resolve(evidenceDir,'stale-quote-rejected.png'),fullPage:true});
    await page.reload();
    await page.getByRole('heading',{name:'Review + confirm'}).waitFor();
    assert.equal(await page.locator('input[name="quote_policy_version"]').inputValue(),'2026-09-30-v1');
    await fillContact();
  }
  const activeDraft=(await context.cookies()).find(cookie=>cookie.name===`pb_booking_draft_${draftId}`);
  await context.clearCookies({name:`pb_booking_draft_${draftId}`});
  if(process.env.EXPECT_EXPIRED_RECEIPT_LOSS!=='1') {
    await page.getByRole('button',{name:'Confirm booking',exact:true}).click();
    await page.getByText('Your private booking draft expired. Return to Property and review your details before confirming.',{exact:true}).waitFor();
    assert.equal(atomicCalls,0);assert.equal(committed.size,0);assert.equal(passwordCalls,0);
    assert.equal(new URL(page.url()).pathname,'/book/confirm');
    // Restore only the synthetic fixture's still-valid cookie to test success
    // without changing the browser's retained request ID or password input.
    await context.addCookies([activeDraft]);
  }
  const responsePromise=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/book/confirm');
  await page.getByRole('button',{name:'Confirm booking',exact:true}).click();
  const response=await responsePromise;
  assert.match(response.headers()['content-type'],/text\/x-component/,'real Server Action/RSC response');
  if(process.env.EXPECT_RECEIPT_LOSS==='1' || process.env.EXPECT_EXPIRED_RECEIPT_LOSS==='1') {
    await page.waitForURL(/\/book\/property/);
    assert.equal(committed.size,1);assert.equal(await page.getByRole('heading',{name:'Booking confirmed'}).count(),0);
    console.log(JSON.stringify({reproduced:true,committedBookings:committed.size,destination:new URL(page.url()).pathname,receiptLost:true,anonymous:true,passwordCalls}));
  } else {
    await page.getByRole('heading',{name:'Booking confirmed',exact:true}).waitFor();
    assert.equal(new URL(page.url()).pathname,'/book/confirm');
    assert.equal(await page.getByRole('button',{name:'Confirm booking',exact:true}).count(),0);
    const cookie=(await context.cookies()).find(cookie=>cookie.name===`pb_booking_draft_${draftId}`);
    assert.ok(cookie);assert.equal(cookie.httpOnly,true);assert.equal(cookie.secure,true);
    const bytes=Buffer.from(cookie.value,'base64url');
    const key=createHash('sha256').update('pixel-booking-private-draft-v1\0').update(secret).digest();
    const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
    decipher.setAAD(Buffer.from(`${org}:${draftId}`));decipher.setAuthTag(bytes.subarray(12,28));
    const completed=Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString();
    assert.ok(!completed.includes('PRIVATE-ACCESS-SENTINEL'),'completed cookie discards access notes');
    assert.match(completed,/receipt/);
    await page.reload();await page.getByRole('heading',{name:'Booking confirmed',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Confirm booking',exact:true}).count(),0);
    assert.ok(submitted?.body);
    await context.clearCookies({name:`pb_booking_draft_${draftId}`});
    const replay=await context.request.post(submitted.url,{headers:{'next-action':submitted.headers['next-action'],'next-router-state-tree':submitted.headers['next-router-state-tree'],'content-type':submitted.headers['content-type'],origin},data:submitted.body});
    assert.equal(replay.status(),200);
    const replayResult=(await replay.text()).split('\n').flatMap(line=>{
      try{return [JSON.parse(line.slice(line.indexOf(':')+1))];}catch{return [];}
    }).find(record=>record?.ok===true);
    assert.equal(replayResult?.redirectTo,`/portal/${propertyId}?booked=1`);
    assert.equal(replayResult?.receipt?.address,'123 Synthetic Receipt Street, Hamilton');
    await page.reload();await page.getByRole('heading',{name:'Booking confirmed',exact:true}).waitFor();
    assert.equal(atomicCalls,2);assert.equal(committed.size,1);assert.equal(durableEffects,1);
    assert.deepEqual(pageErrors,[]);assert.deepEqual(unexpected,[]);
    if(evidenceDir)await page.screenshot({path:resolve(evidenceDir,'confirmed-after-reload.png'),fullPage:true});
    console.log(JSON.stringify({passed:true,privatePortalRebooking:true,boundedRepeatedRebookCookies:true,expiredAnonymousRejectedBeforeEffects:true,anonymousSessionReceipt:true,expiredCommittedReplay:true,staleQuoteRejectedBeforeEffects:true,realPostRsc:true,confirmationSurvivesReload:true,privateDraftRemoved:true,replayAtomicCalls:atomicCalls,committedBookings:committed.size,durableEffects,pageErrors,unexpected}));
  }
} catch(error) { if(evidenceDir)writeFileSync(resolve(evidenceDir,'server.log'),serverLog);throw error; }
finally {
  await browser?.close();child.kill('SIGTERM');
  await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);
  transport.closeAllConnections();await new Promise(resolve=>transport.close(resolve));
}
