import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {expect} from 'playwright/test';
import {startGalleryFixture} from './helpers/website-gallery-fixture.mjs';
import {websiteGalleries} from './helpers/website-gallery-source.mjs';
const fixture=await startGalleryFixture();const errors=[];let browser;
try{
 browser=await chromium.launch({headless:true});
 for(const width of [1440,390]){
  fixture.reset();const context=await browser.newContext({viewport:{width,height:900}});
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin===fixture.origin)return route.continue();
   // Real image bytes, delivered locally so CI has no dependency on a live host.
   if(url.origin==='https://pixelblastermedia.com'&&/^\/assets\/portfolio\/[a-z0-9-]+\.webp$/.test(url.pathname))return route.fulfill({contentType:'image/webp',body:readFileSync(path.join(fixture.root,'..',url.pathname))});
   if(['https://youriguide.com','https://customer-example.cloudflarestream.com'].includes(url.origin))return route.fulfill({contentType:'text/html',body:'<p>Local provider fixture</p>'});
   errors.push('Unexpected external request: '+url.origin);return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(fixture.origin+'/editor');
  for(const [index,gallery]of websiteGalleries.WEBSITE_GALLERIES.entries()){
   if(index===0){
    await page.getByRole('button',{name:'Add photo URL',exact:true}).click();
    await page.getByLabel('Example title',{exact:true}).fill('Preserved custom gallery title');
    await page.getByLabel('HTTPS URL',{exact:true}).fill(gallery.url);
    await expect(page.getByRole('button',{name:'Add photo to gallery',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Use as website gallery',exact:true}).click();
    await expect(page.getByLabel('Example title',{exact:true})).toHaveValue('Preserved custom gallery title');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
   }else{
    await page.getByRole('button',{name:'Add website gallery',exact:true}).click();
    await page.getByLabel(/^Website gallery/).selectOption(gallery.url);
   }
   await expect(page.getByLabel(/^Show sample under/)).toHaveValue('photos');
   await page.getByRole('button',{name:'Preview gallery',exact:true}).click();
   const dialog=page.getByRole('dialog',{name:gallery.label,exact:true});
   await expect(dialog).toBeVisible();await expect(dialog.locator('img')).toHaveCount(gallery.count);
   await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
   await expect(page.getByRole('button',{name:'Preview gallery',exact:true})).toBeFocused();
   await page.getByRole('button',{name:'Attach gallery',exact:true}).click();
   await expect.poll(()=>fixture.getWrites()).toBe(index+1);
   await expect(page.getByRole('button',{name:'Attach gallery',exact:true})).toHaveCount(0);
  }
  await page.getByRole('link',{name:'Booking fixture',exact:true}).click();
  const before=page.url();await page.getByLabel('Unsaved booking note').fill('Keep my selection and private draft');
  const details=page.locator(width>600?'.booking-refresh-details-desktop':'.booking-refresh-details-mobile').first();
  if(width===390)await details.locator(':scope > summary').click();
  await details.locator('.booking-refresh-examples > summary').click();
  for(const[index,gallery]of websiteGalleries.WEBSITE_GALLERIES.entries()){
   const button=details.locator(`[data-booking-example="example-${index+1}"]`);
   await button.click();const dialog=page.getByRole('dialog',{name:gallery.label,exact:true});
   await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'Close website gallery',exact:true})).toBeFocused();
   for(let n=0;n<8;n++){
    await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true,'focus stays in modal');
   }
   for(const img of await dialog.locator('img').all()){
    await img.scrollIntoViewIfNeeded();await expect.poll(()=>img.evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);
   }
   assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'no horizontal overflow');
   assert.equal(page.url(),before);assert.equal(context.pages().length,1);
   if(process.env.GALLERY_SCREENSHOTS){mkdirSync(process.env.GALLERY_SCREENSHOTS,{recursive:true});await dialog.evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(process.env.GALLERY_SCREENSHOTS,`${width}-${gallery.slug}.png`)})}
   if(index===0)await page.keyboard.press('Escape');
   else if(index===1)await page.mouse.click(2,2);
   else await dialog.getByRole('button',{name:'Close website gallery',exact:true}).click();
   await expect(dialog).toHaveCount(0);await expect(button).toBeFocused();
   await expect(page.getByLabel('Unsaved booking note')).toHaveValue('Keep my selection and private draft');
   await expect(page.getByRole('button',{name:'Selected Blue Print fixture',exact:true})).toHaveAttribute('aria-pressed','true');
   assert.equal(page.url(),before);
  }
  // Changing viewport while open restores focus to the visible disclosure, not the hidden layout.
  await details.locator('[data-booking-example="example-6"]').click();
  await page.setViewportSize({width:width===390?1440:390,height:900});await page.keyboard.press('Escape');
  await expect(page.locator('.website-gallery-dialog')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>document.activeElement?.getClientRects().length>0)).toBe(true);
  await page.setViewportSize({width,height:900});
  await page.getByRole('button',{name:/Build a custom order/}).click();
  const legacy=page.locator('article').filter({has:page.getByRole('heading',{name:'Other example types',exact:true})});
  await legacy.locator('.booking-refresh-details > summary').click();await legacy.locator('.booking-refresh-examples > summary').click();
  await legacy.getByRole('button',{name:/Enlarge Individual photo/}).click();
  await expect(page.locator('dialog[open] img')).toHaveAttribute('src','https://pixelblastermedia.com/assets/portfolio/stone-timber-fireplace-640.webp');
  await page.keyboard.press('Escape');
  for(const name of [/Explore iGUIDE/,/Watch sample/]){
   await legacy.getByRole('button',{name}).click();await expect(page.locator('dialog[open] iframe')).toHaveCount(1);await page.keyboard.press('Escape');await expect(page.locator('iframe')).toHaveCount(0);
  }
  await expect(legacy.getByRole('link',{name:/External album/})).toHaveAttribute('target','_blank');
  assert.equal(page.url(),before);assert.equal(fixture.getWrites(),6);
  await context.close();console.log(`${width}px: all six editor → actual validation → booking overlays; 97 photos loaded; close/Escape/backdrop, focus trap/return, resize, selected package/add-on/draft, photo/iGUIDE/video/external behavior passed.`);
 }
 assert.deepEqual(errors,[]);
}finally{await browser?.close();await fixture.close()}
