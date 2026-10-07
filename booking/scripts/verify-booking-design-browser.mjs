import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Drive the REAL built app only through a loopback fixture. The fixture must
// refuse backend mutations; this runner never confirms a booking or signs in.
const origin = process.env.BOOKING_DESIGN_QA_ORIGIN;
assert.ok(origin && new URL(origin).hostname === '127.0.0.1', 'explicit loopback preview required');
const fixture = JSON.parse(readFileSync(process.env.BOOKING_DESIGN_CATALOG_FIXTURE, 'utf8'));
const assetDir = process.env.BOOKING_DESIGN_ASSET_DIR;
const assets = JSON.parse(readFileSync(resolve(assetDir, 'sources.json'), 'utf8'));
const output = process.env.BOOKING_DESIGN_EVIDENCE_DIR;
assert.ok(output, 'explicit evidence directory required');
mkdirSync(output, {recursive:true});
const catalog = ['bundles','aLaCarte','addons'].flatMap(key=>fixture[key]);
const samples = new Set(catalog.flatMap(item=>item.examples.flatMap(example=>[example.external_url,example.embed_url].filter(Boolean))));
const assetFiles = new Map([[assets.logo,'logo.jpg'],[assets.hero,'hero.jpg'],[assets.secondary,'hero-secondary.png']]);
const browser = await chromium.launch({headless:true, executablePath:process.env.BOOKING_CHROME_PATH});
const context = await browser.newContext({viewport:{width:1280,height:1200}});
const errors = [], unexpected = [], sampleRequests = [], checks = [];
const configureContext=async current=>{
current.on('page',page=>{
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{
  if(message.type()==='error'&&/hydrat|did not match|didn't match|server rendered HTML/i.test(message.text()))errors.push(message.text());
 });
});
await current.route('**/*',async route=>{
 const request=route.request();const url=request.url();
 if(new URL(url).origin === origin) return route.continue();
 if(assetFiles.has(url))return route.fulfill({status:200,contentType:url===assets.secondary?'image/png':'image/jpeg',body:readFileSync(resolve(assetDir,assetFiles.get(url)))});
 if(samples.has(url)){
  sampleRequests.push({url,method:request.method(),referer:request.headers().referer??null});
  if(url.includes('unavailable'))return route.abort();
  if(/\.(?:jpg|png)$/.test(new URL(url).pathname))return route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
  return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Isolated example navigation</title><button>Mock sample control</button><p>Provider content is isolated for this local navigation test.</p>'});
 }
 unexpected.push(new URL(url).origin+new URL(url).pathname);return route.abort();
});
};
await configureContext(context);
const page=await context.newPage();page.setDefaultTimeout(12000);
const total=page.getByRole('region',{name:'Booking selection',exact:true});
const card=slug=>page.locator(`article[aria-labelledby="package-${slug}"]`);
const assertPrivateUrl=()=>{
 const url=new URL(page.url());
 for(const key of ['address','city','postal','sqft','basement','vacant','notes','shoot_notes'])assert.equal(url.searchParams.has(key),false,key+' must remain private');
 assert.ok(!decodeURIComponent(url.href).includes('SYNTHETIC-DESIGN'));
};
const checkLayout=async name=>{
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
 assert.equal(overflow,false,name+' must not overflow horizontally');
 assertPrivateUrl();checks.push(name);
};
const capture=async(name,{fullPage=false}={})=>{
 await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.screenshot({path:resolve(output,name+'.png'),fullPage,animations:'disabled'});
 writeFileSync(resolve(output,name+'.aria.txt'),await page.locator('body').ariaSnapshot());
};
const settledClearance=async()=>{
 await page.waitForFunction(()=>{
  const footer=document.querySelector('.booking-refresh-total');
  const measured=parseFloat(document.documentElement.style.getPropertyValue('--booking-footer-height'));
  return measured===Math.ceil(footer.getBoundingClientRect().height)
   && parseFloat(getComputedStyle(document.querySelector('.booking-shell > div')).paddingBottom)>=measured+16;
 });
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
};
const assertFooter=async()=>{
 await settledClearance();
 const g=await total.evaluate(element=>{const r=element.getBoundingClientRect();return {position:getComputedStyle(element).position,top:r.top,bottom:r.bottom,height:innerHeight};});
 assert.equal(g.position,'fixed');assert.ok(Math.abs(g.bottom-g.height)<2);assert.ok(g.top>=0);
 const button=total.getByRole('link',{name:'Continue',exact:true});assert.ok(await button.isVisible());
};
try{
 // Let Next reveal its streamed server HTML, while blocking the client bundles
 // so these assertions run before React hydration or viewport effects.
 for(const viewport of [{width:1280,height:900},{width:390,height:844},{width:767,height:900},{width:768,height:900}]){
  const serverContext=await browser.newContext({viewport});await configureContext(serverContext);
  await serverContext.route('**/_next/static/**/*.js',route=>route.abort());
  try{
   const serverPage=await serverContext.newPage();await serverPage.goto(origin+'/book');
   await serverPage.locator('#packages article').first().waitFor({state:'visible'});
   assert.equal(await serverPage.evaluate(()=>document.documentElement.style.getPropertyValue('--booking-footer-height')),'','React must not have hydrated');
   const visible=serverPage.locator('#packages article > details:visible');
   assert.equal(await visible.count(),fixture.bundles.length);
   const open=await visible.evaluateAll(elements=>elements.map(element=>element.open));
   assert.ok(open.every(value=>value===(viewport.width>=768)),'SSR disclosure default '+viewport.width);
   assert.equal(await serverPage.locator('.booking-refresh-examples[open]').count(),0);
   if([390,1280].includes(viewport.width)){
    const firstPackage=serverPage.locator('#packages article').first();
    await firstPackage.evaluate(element=>element.scrollIntoView({block:'start'}));
    await firstPackage.screenshot({path:resolve(output,'package-default-'+viewport.width+'.png'),animations:'disabled'});
   }
  }finally{await serverContext.close();}
 }
 checks.push('responsive-package-default-before-react-hydration');
 const mobileContext=await browser.newContext({viewport:{width:390,height:844}});await configureContext(mobileContext);
 try{
  const mobilePage=await mobileContext.newPage();await mobilePage.goto(origin+'/book');
  await mobilePage.waitForFunction(()=>document.documentElement.style.getPropertyValue('--booking-footer-height'));
  const visible=mobilePage.locator('#packages article > details:visible');
  assert.equal(await visible.count(),fixture.bundles.length);
  assert.ok((await visible.evaluateAll(elements=>elements.map(element=>element.open))).every(value=>!value));
  assert.equal(await mobilePage.locator('.booking-refresh-examples[open]').count(),0);
 }finally{await mobileContext.close();}
 checks.push('mobile-first-hydration-retains-collapsed-package-and-example-defaults');
 await page.goto(origin+'/book');
 await page.getByRole('heading',{name:'Choose your package'}).waitFor();
 await settledClearance(); // confirms React hydration has installed the footer effect
 const packageDetails=()=>card('social_media_special').locator(':scope > details:visible');
 assert.notEqual(await packageDetails().getAttribute('open'),null,'desktop remains open after hydration');
 await packageDetails().locator(':scope > summary').focus();await page.keyboard.press('Enter');
 assert.equal(await packageDetails().getAttribute('open'),null,'desktop closes manually');
 await page.setViewportSize({width:390,height:844});
 assert.equal(await packageDetails().getAttribute('open'),null,'mobile starts collapsed');
 await packageDetails().locator(':scope > summary').focus();await page.keyboard.press('Space');
 assert.notEqual(await packageDetails().getAttribute('open'),null,'mobile opens manually');
 assert.equal(await packageDetails().locator('.booking-refresh-examples').getAttribute('open'),null,'nested examples remain closed');
 await page.setViewportSize({width:1280,height:900});
 assert.equal(await packageDetails().getAttribute('open'),null,'desktop remembers manual close after resize');
 const customDisclosure=page.getByRole('button',{name:/Build a custom order/});
 await customDisclosure.click();await customDisclosure.click();
 assert.equal(await packageDetails().getAttribute('open'),null,'desktop manual close survives React rerenders');
 await packageDetails().locator(':scope > summary').click();
 await page.setViewportSize({width:390,height:844});
 assert.notEqual(await packageDetails().getAttribute('open'),null,'mobile remembers manual open after resize');
 await packageDetails().locator(':scope > summary').click();
 await page.setViewportSize({width:1280,height:1200});
 checks.push('hydration-and-resize-preserve-native-user-disclosure-choices');
 assert.equal(await total.getByRole('button',{name:'Continue',exact:true}).isDisabled(),true);
 assert.equal(await page.locator('iframe, dialog[open]').count(),0);
 assert.equal(await page.locator('.booking-refresh-header img').count(),2);
 assert.equal(await page.locator('.booking-refresh').evaluate(e=>getComputedStyle(e).getPropertyValue('--realtor-primary').trim()),'#1a7f8e');
 await checkLayout('desktop-initial');
 await page.getByRole('button',{name:'Choose package: Social Media Special',exact:true}).click();
 await page.waitForURL(url=>url.searchParams.get('services')==='social_media_special');
 await page.getByRole('button',{name:'Selected Social Media Special',exact:true}).waitFor();
 assert.match(await total.innerText(),/\$600/);
 await page.evaluate(()=>scrollTo(0,0));await assertFooter();
 await capture('Pixel-Blaster-Booking-Desktop-2026-10-03');
 // This is an entry overview, not the resize-with-focus regression below.
 // Clear selection-button focus before resizing so intentional focus recovery
 // cannot scroll the page while the overview screenshot is being captured.
 await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>scrollTo(0,0));await checkLayout('mobile-top');
 await page.waitForFunction(()=>scrollY===0&&document.querySelector('.booking-refresh-brandline').getBoundingClientRect().top>=0);
 await capture('Pixel-Blaster-Booking-Mobile-2026-10-03');
 const special=card('social_media_special');
 const details=special.locator(':scope > details:visible');
 const summary=details.locator(':scope > summary');
 // Native details retain Enter/Space semantics and never toggle package choice.
 const selectionUrl=page.url();
 for(let i=0;i<3;i++){
  await summary.focus();await page.keyboard.press('Enter');assert.notEqual(await details.getAttribute('open'),null);
  await page.keyboard.press('Space');assert.equal(await details.getAttribute('open'),null);
  assert.equal(page.url(),selectionUrl);
 }
 await summary.focus();await page.keyboard.press('Enter');
 const nested=details.locator('.booking-refresh-examples');const nestedSummary=nested.locator(':scope > summary');
 await special.evaluate(e=>e.scrollIntoView({block:'start'}));
 await capture('Pixel-Blaster-Booking-Examples-Closed-2026-10-03');
 for(let i=0;i<3;i++){
  await nestedSummary.focus();await page.keyboard.press('Enter');assert.notEqual(await nested.getAttribute('open'),null);
  await page.keyboard.press('Space');assert.equal(await nested.getAttribute('open'),null);
 }
 await nestedSummary.focus();await page.keyboard.press('Enter');
 assert.equal(await nestedSummary.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
 assert.ok(await nestedSummary.evaluate(e=>e.getBoundingClientRect().height>=44));
 assert.ok(await nested.locator('a, button').first().evaluate(e=>e.getBoundingClientRect().height>=44));
 assert.equal(page.url(),selectionUrl);
 await checkLayout('mobile-keyboard-nested-examples');
 const externalContext=await browser.newContext({viewport:{width:1280,height:900}});await configureContext(externalContext);
 try{
  const externalPage=await externalContext.newPage();await externalPage.goto(origin+'/book?services=blue_print');
  await externalPage.getByRole('button',{name:'Selected The Blue Print',exact:true}).waitFor();
  await externalPage.locator('details').evaluateAll(elements=>elements.forEach(element=>element.open=true));
  const external=externalPage.locator('.booking-refresh-examples a:visible').first();
  assert.equal(await external.getAttribute('target'),'_blank');
  assert.equal(await external.getAttribute('rel'),'noopener noreferrer');
  const expectedUrl=await external.getAttribute('href');
  const popupPromise=externalContext.waitForEvent('page');await external.click();const popup=await popupPromise;
  await popup.waitForURL(expectedUrl);await popup.waitForLoadState('domcontentloaded');assert.equal(popup.url(),expectedUrl);assert.equal(await popup.evaluate(()=>window.opener),null);
  await popup.close();assert.equal(new URL(externalPage.url()).searchParams.get('services'),'blue_print');
 }finally{await externalContext.close();}
 const sampleContext=await browser.newContext({viewport:{width:390,height:844}});await configureContext(sampleContext);
 try{
  const samplePage=await sampleContext.newPage();await samplePage.goto(origin+'/book?services=blue_print');
  await samplePage.getByRole('button',{name:'Selected The Blue Print',exact:true}).waitFor();
  const startUrl=samplePage.url();
  for(const width of [390,1280]){
   await samplePage.setViewportSize({width,height:900});
   const photoCard=samplePage.locator('article[aria-labelledby="package-blue_print"]');
   await photoCard.locator('details').evaluateAll(elements=>elements.forEach(element=>element.open=true));
   const thumb=photoCard.locator('button:visible').filter({hasText:'Synthetic photo one'}).first();
   await thumb.focus();await samplePage.keyboard.press('Enter');
   const gallery=samplePage.locator('dialog[open]');await gallery.waitFor();
   await gallery.getByRole('img',{name:'Synthetic photo one',exact:true}).waitFor();
   assert.equal(await gallery.getByRole('button',{name:'Close sample photos',exact:true}).evaluate(e=>document.activeElement===e),true);
   await samplePage.keyboard.press('ArrowRight');await gallery.getByRole('img',{name:'Synthetic photo two',exact:true}).waitFor();
   assert.match(await gallery.getByRole('status').innerText(),/Photo 2 of 3/);
   await gallery.getByRole('button',{name:'Next photo',exact:true}).click();
   await gallery.getByRole('status').filter({hasText:'could not load'}).waitFor();
   await gallery.getByRole('button',{name:'Next photo',exact:true}).click();await gallery.getByRole('img',{name:'Synthetic photo one',exact:true}).waitFor();
   await gallery.screenshot({path:resolve(output,'photo-gallery-'+width+'.png')});
   await gallery.getByRole('button',{name:'Close sample photos',exact:true}).focus();await samplePage.keyboard.press('Escape');
   await samplePage.waitForFunction(()=>document.querySelectorAll('dialog[open]').length===0);
   await thumb.evaluate(e=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
   assert.equal(await thumb.evaluate(e=>document.activeElement===e),true);
   const tour=samplePage.getByRole('button',{name:/opens iGUIDE tour/}).first();
   await samplePage.locator('details').evaluateAll(elements=>elements.forEach(element=>element.open=true));
   await tour.click();const tourDialog=samplePage.locator('dialog[open]');await tourDialog.waitFor();
   const tourFrame=tourDialog.locator('iframe');const tourUrl=await tourFrame.getAttribute('src');assert.ok(samples.has(tourUrl));
   await samplePage.frameLocator('dialog[open] iframe').getByRole('button',{name:'Mock sample control',exact:true}).waitFor();
   assert.equal(await tourFrame.getAttribute('referrerpolicy'),'no-referrer');
   assert.equal(await tourDialog.getByRole('link',{name:'Open the original tour in a new tab',exact:true}).getAttribute('href'),tourUrl);
   await tourDialog.screenshot({path:resolve(output,'iguide-popup-'+width+'.png')});
   await tourDialog.getByRole('button',{name:'Close sample tour',exact:true}).click();await samplePage.waitForFunction(()=>document.querySelectorAll('dialog[open],iframe').length===0);
   assert.equal(await tour.evaluate(e=>document.activeElement===e),true);assert.equal(samplePage.url(),startUrl);assert.equal(sampleContext.pages().length,1);
   assert.equal(await samplePage.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  }
  checks.push('photo-gallery-thumbnail-arrows-wrap-error-recovery-and-escape-mobile-desktop','iguide-popup-lazy-load-fallback-referrer-focus-and-selection-mobile-desktop');
 }finally{await sampleContext.close();}
 assert.equal(page.url(),selectionUrl);assert.equal(await special.getByRole('button',{name:'Selected Social Media Special',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(sampleRequests[0].referer,null);checks.push('external-new-tab-return-preserves-selection-and-referrer-privacy');
 // Stream's restricted player stays inside this origin and is lazy-loaded.
 const videoButton=nested.getByRole('button',{name:/opens video player/}).first();
 assert.equal(await page.locator('iframe').count(),0);
 await videoButton.focus();await page.keyboard.press('Enter');
 const player=page.getByRole('dialog');await player.waitFor({state:'visible'});
 const frame=player.locator('iframe');await frame.waitFor();
 const videoSrc=await frame.getAttribute('src');assert.ok(samples.has(videoSrc));
 await page.frameLocator('dialog[open] iframe').getByRole('button',{name:'Mock sample control',exact:true}).waitFor();
 assert.equal(page.url(),selectionUrl);assert.equal(context.pages().length,1);
 const close=player.getByRole('button',{name:'Close sample video',exact:true});
 assert.equal(await close.evaluate(e=>document.activeElement===e),true);
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).overflow),'hidden');
 for(let index=0;index<4;index++){
  await page.keyboard.press('Tab');
  const focusState=await player.evaluate(e=>({inside:e.contains(document.activeElement),tag:document.activeElement.tagName,hasFocus:document.hasFocus()}));
  // Native dialog permits focus to enter browser chrome; booking controls stay inert.
  assert.ok(focusState.inside || (!focusState.hasFocus && focusState.tag==='BODY'),JSON.stringify(focusState));
 }
 await page.getByRole('link',{name:'Continue',exact:true}).evaluate(e=>e.focus());
 assert.equal(await page.getByRole('link',{name:'Continue',exact:true}).evaluate(e=>document.activeElement===e),false,'background booking navigation is inert');
 await close.focus();
 await player.screenshot({path:resolve(output,'video-player-mobile.png'),animations:'disabled'});
 await page.keyboard.press('Escape');await player.waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0);
 assert.equal(await videoButton.evaluate(e=>document.activeElement===e),true);
 await videoButton.click();await player.waitFor({state:'visible'});await page.setViewportSize({width:1280,height:900});
 await close.click();await player.waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0);
 const restoredFocus=await card('social_media_special').evaluate(e=>{const active=document.activeElement;return {visible:!!active?.getClientRects().length,inCard:e.contains(active),tag:active?.tagName,example:active?.getAttribute('data-booking-example')};});
 assert.ok(restoredFocus.visible && restoredFocus.inCard && (restoredFocus.tag==='SUMMARY' || restoredFocus.example),JSON.stringify(restoredFocus));
 await page.setViewportSize({width:390,height:844});
 await videoButton.click();await player.waitFor({state:'visible'});await close.click();await player.waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0);
 assert.equal(page.url(),selectionUrl);
 const streamRequest=sampleRequests.find(request=>request.url===videoSrc);
 assert.ok(streamRequest);assert.equal(streamRequest.referer,origin+'/');
 checks.push('stream-player-stays-on-site-with-focus-escape-close-cleanup-and-origin-only-referrer');
 // Repeated native disclosure toggles retain state through selection rerenders.
 await summary.click();assert.equal(await details.getAttribute('open'),null);await summary.click();
 assert.notEqual(await nested.getAttribute('open'),null);
 await nested.evaluate(e=>e.scrollIntoView({block:'center'}));await checkLayout('mobile-example-open');
 await capture('Pixel-Blaster-Booking-Examples-2026-10-03');
 await page.getByRole('button',{name:'Choose package: The Blue Print',exact:true}).click();
 await page.waitForURL(url=>url.searchParams.get('services')==='blue_print');
 await page.getByRole('button',{name:'Add to booking: Aerial Add-on',exact:true}).click();
 await page.waitForURL(url=>url.searchParams.get('add_ons')==='aerial_add_on');
 await page.getByRole('button',{name:'Choose package: Social Media Special',exact:true}).click();
 await page.waitForURL(url=>url.searchParams.get('services')==='social_media_special'&&!url.searchParams.has('add_ons'));
 assert.equal(await page.getByRole('button',{name:'Add to booking: Aerial Add-on',exact:true}).count(),0);
 checks.push('bundle-replacement-and-ineligible-addon-pruning');
 const custom=page.getByRole('button',{name:/Build a custom order/});await custom.focus();await page.keyboard.press('Enter');
 assert.equal(await custom.getAttribute('aria-expanded'),'true');
 await page.getByRole('button',{name:'Add service: Video Tour',exact:true}).click();
 await page.waitForURL(url=>url.searchParams.get('services')==='social_media_special,video_tour');
 await page.getByRole('button',{name:'Added: Video Tour (remove service)',exact:true}).waitFor();
 await page.getByRole('button',{name:'Add to booking: Put me on camera',exact:true}).click();
 await page.waitForURL(url=>url.searchParams.get('add_ons')==='on_camera');
 await page.getByRole('button',{name:'Added: Put me on camera (remove add-on)',exact:true}).click();
 await page.waitForURL(url=>!url.searchParams.has('add_ons'));
 assert.match(await total.innerText(),/\$925/);
 await page.reload();await page.getByRole('button',{name:'Added: Video Tour (remove service)',exact:true}).waitFor();
 assert.equal(await custom.getAttribute('aria-expanded'),'true');
 for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:900});await checkLayout(`viewport-${width}`);await assertFooter();
  await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await assertFooter();
  const portal=page.getByRole('link',{name:'Open client portal',exact:true});const p=await portal.boundingBox();const f=await total.boundingBox();
  assert.ok(p.y+p.height<f.y,'footer link remains above fixed total');
 }
 checks.push('sticky-footer-and-last-control-clearance');
 // Reproduce the independent review's four-item expanded-footer case.
 await page.getByRole('button',{name:'Add to booking: Put me on camera',exact:true}).click();
 await page.waitForURL(url=>url.searchParams.get('add_ons')==='on_camera');
 await page.getByRole('button',{name:'Add to booking: Site Plan',exact:true}).click();
 await page.waitForURL(url=>url.searchParams.get('add_ons')==='on_camera,site_plan');
 const priceDetails=total.locator('details');const priceSummary=priceDetails.locator('summary');
 const expandedFooterObservations=[];
 const focusedPortalGeometry=async label=>{
  const geometry=await page.evaluate(()=>{
   const portal=document.querySelector('footer a');const p=portal.getBoundingClientRect();
   const f=document.querySelector('.booking-refresh-total').getBoundingClientRect();
   const hit=document.elementFromPoint(p.x+p.width/2,p.y+p.height/2);
   return {width:innerWidth,height:innerHeight,portalTop:p.top,portalBottom:p.bottom,footerTop:f.top,footerHeight:f.height,focused:document.activeElement===portal,hit:hit===portal||portal.contains(hit)};
  });
  assert.equal(geometry.focused,true,label+' actual Tab focus');
  assert.ok(geometry.portalTop>=7&&geometry.portalBottom+7<=geometry.footerTop,label+' full focus outline above footer: '+JSON.stringify(geometry));
  assert.equal(geometry.hit,true,label+' receives pointer hit');
  expandedFooterObservations.push({label,...geometry});
 };
 for(const [index,viewport] of [{width:390,height:844},{width:320,height:568},{width:1280,height:800},{width:844,height:390}].entries()){
  await page.setViewportSize(viewport);await settledClearance();
  if(index>0)await focusedPortalGeometry('resize-while-open-'+viewport.width);
  if(await priceDetails.getAttribute('open')!==null){await priceSummary.focus();await page.keyboard.press('Enter');await settledClearance();}
  const closedHeight=await total.evaluate(e=>e.getBoundingClientRect().height);
  await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
  await priceSummary.focus();await page.keyboard.press('Enter');await settledClearance();
  assert.notEqual(await priceDetails.getAttribute('open'),null);
  assert.ok(await total.evaluate(e=>e.getBoundingClientRect().height)>closedHeight,'expanded height actually changed');
  await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
  await priceSummary.focus();await page.keyboard.press('Tab');await settledClearance();
  await focusedPortalGeometry('expanded-'+viewport.width+'x'+viewport.height);
  await capture('focused-portal-expanded-'+viewport.width+'x'+viewport.height);
  await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});await settledClearance();
  await focusedPortalGeometry('text-200-percent-'+viewport.width);
  await page.evaluate(()=>{document.documentElement.style.fontSize='';});await settledClearance();
  await focusedPortalGeometry('text-reset-'+viewport.width);
 }
 writeFileSync(resolve(output,'expanded-footer.json'),JSON.stringify(expandedFooterObservations,null,2)+'\n');
 checks.push('expanded-footer-actual-tab-pointer-resize-and-200-percent-text');
 await priceSummary.focus();await page.keyboard.press('Enter');await settledClearance();
 const namedControls=await page.locator('.booking-refresh-select, .booking-refresh-example-group a').evaluateAll(elements=>elements.map(element=>{
  const clone=element.cloneNode(true);clone.querySelectorAll('[aria-hidden="true"]').forEach(node=>node.remove());
  return {visible:clone.textContent.replace(/\s+/g,' ').trim(),name:element.getAttribute('aria-label')};
 }));
 for(const control of namedControls)assert.ok(control.name.startsWith(control.visible),JSON.stringify(control));
 writeFileSync(resolve(output,'label-in-name.json'),JSON.stringify(namedControls,null,2)+'\n');
 checks.push('visible-action-labels-preserved-in-accessible-names');
 await page.getByRole('button',{name:'Added: Put me on camera (remove add-on)',exact:true}).click();
 await page.waitForURL(url=>url.searchParams.get('add_ons')==='site_plan');
 await page.getByRole('button',{name:'Added: Site Plan (remove add-on)',exact:true}).click();
 await page.waitForURL(url=>!url.searchParams.has('add_ons'));
 await page.setViewportSize({width:390,height:844});
 await total.getByRole('link',{name:'Continue',exact:true}).click();await page.waitForURL(/\/book\/property/);
 assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--booking-footer-height')), '', 'footer clearance is cleaned up outside Services');
 await page.locator('input[name="address"]').fill('123 SYNTHETIC-DESIGN Street');
 await page.locator('input[name="city"]').fill('Hamilton');
 await page.locator('input[name="postal"]').fill('L8P 4S8');
 await page.locator('input[name="sqft"]').fill('2500');
 await page.getByText('Occupied',{exact:true}).click();
 await page.getByText('Yes, shoot the basement',{exact:true}).click();
 await page.locator('summary').filter({hasText:'Optional shot requests'}).click();
 await page.getByRole('textbox',{name:'Specific shot notes (optional)'}).fill('SYNTHETIC-DESIGN PRIVATE ACCESS 4567');
 assert.match(await page.locator('body').innerText(),/\$925/);
 assert.match(await page.locator('body').innerText(),/3h 15min/);
 await page.locator('input[name="sqft"]').fill('2501');
 assert.match(await page.locator('body').innerText(),/\$1065/);
 assert.match(await page.locator('body').innerText(),/3h 15min/);
 await checkLayout('private-property-boundary-pricing-basement-once');
 await page.getByRole('button',{name:'Continue',exact:true}).click();await page.waitForURL(/\/book\/schedule/);
 const draft=new URL(page.url()).searchParams.get('draft');assert.ok(draft);
 await page.reload();await page.getByRole('heading',{name:'When works for you?'}).waitFor();await checkLayout('private-draft-reload');
 await page.getByRole('button',{name:/— \d+ available times?/}).first().click();
 await page.getByRole('button',{name:/ at .*\(America\/Toronto\)/}).first().click();await page.waitForURL(/\/book\/confirm/);
 await page.getByRole('heading',{name:'Review + confirm'}).waitFor();
 assert.match(await page.locator('body').innerText(),/SYNTHETIC-DESIGN PRIVATE ACCESS 4567/);assertPrivateUrl();
 assert.ok(new URL(page.url()).searchParams.has('slot'));
 // Final submission is deliberately never clicked.
 await page.getByRole('link',{name:'Services',exact:true}).click();await page.waitForURL(url=>url.pathname==='/book');
 await page.goBack();await page.waitForURL(/\/book\/confirm/);
 await page.goForward();await page.waitForURL(url=>url.pathname==='/book');
 await page.getByRole('button',{name:'Added: Video Tour (remove service)',exact:true}).click();
 await page.waitForURL(url=>url.searchParams.get('services')==='social_media_special'&&!url.searchParams.has('slot'));
 assert.equal(new URL(page.url()).searchParams.get('draft'),draft);
 assert.match(await total.innerText(),/\$690/);assert.match(await total.innerText(),/2h 15min/);
 assert.match(await page.locator('#packages').innerText(),/Prices for 2,501 sqft · CAD/);
 await total.getByRole('link',{name:'Continue',exact:true}).click();await page.waitForURL(/\/book\/property/);
 assert.equal(await page.locator('input[name="address"]').inputValue(),'123 SYNTHETIC-DESIGN Street');
 assert.equal(await page.locator('input[name="sqft"]').inputValue(),'2501');
 await page.locator('summary').filter({hasText:'Optional shot requests'}).click();
 assert.equal(await page.getByRole('textbox',{name:'Specific shot notes (optional)'}).inputValue(),'SYNTHETIC-DESIGN PRIVATE ACCESS 4567');
 await checkLayout('back-forward-private-draft-selection-change-slot-cleared');
 const cookies=(await context.cookies()).filter(c=>c.name.startsWith('pb_booking_draft_'));
 assert.equal(cookies.length,1);assert.equal(cookies[0].httpOnly,true);assert.equal(cookies[0].secure,true);assert.equal(cookies[0].path,'/book');assert.ok(!cookies[0].value.includes('SYNTHETIC'));
 checks.push('encrypted-httpOnly-secure-private-cookie');
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 const result={passed:true,checks,viewports:[320,390,768,1280],syntheticOnly:true,finalBookingSubmitted:false,providerPlaybackTested:false,sampleRequests,pageErrors:errors,unexpectedExternal:unexpected};
 writeFileSync(resolve(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{});writeFileSync(resolve(output,'failure.txt'),String(error)+'\n'+await page.locator('body').innerText());throw error;
}finally{await browser.close();}
