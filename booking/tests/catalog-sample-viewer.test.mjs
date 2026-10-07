import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource } from './helpers/source-module.mjs';
const {photoSampleHref,iGuideSampleHref,streamSampleHref,sampleHref}=loadSource('lib/booking/catalog-sample-viewer.ts');
test('photo viewers accept public raster URLs while keeping album links external',()=>{
 for(const extension of ['jpg','JPEG','png','webp','avif','gif'])assert.equal(photoSampleHref(`https://images.example.invalid/photo.${extension}?quality=90`),`https://images.example.invalid/photo.${extension}?quality=90`);
 for(const href of ['https://imagedelivery.net/account-hash/image-id/public','https://images.example.invalid/cdn-cgi/imagedelivery/account-hash/image-id/public'])assert.equal(photoSampleHref(href),href);
 assert.equal(photoSampleHref('https://imagedelivery.net.attacker.invalid/account/image/public'),undefined);
 for(const suffix of ['svg','html','jpg/other'])assert.equal(photoSampleHref(`https://images.example.invalid/photo.${suffix}`),undefined);
 assert.equal(photoSampleHref('https://images.example.invalid/album'),undefined);
});
test('all embedded samples reject credentials, private/literal hosts, ports and unsafe schemes',()=>{
 for(const href of ['javascript:alert(1)','http://images.example.invalid/p.jpg','https://user:secret@images.example.invalid/p.jpg','https://localhost/p.jpg','https://127.0.0.1/p.jpg','https://[::1]/p.jpg','https://host.internal/p.jpg'])assert.equal(sampleHref(href),undefined);
 assert.equal(sampleHref('https://example.invalid:444/legacy'), 'https://example.invalid:444/legacy');
 assert.equal(photoSampleHref('https://images.example.invalid:444/p.jpg'),undefined);
 assert.equal(iGuideSampleHref('https://youriguide.com:444/tour'),undefined);
 assert.equal(streamSampleHref('https://customer-example.cloudflarestream.com:444/ae26683a8919895dabdb9b102e5679d3/iframe'),undefined);
 assert.equal(sampleHref('https://example.invalid/'+ 'a'.repeat(2048)),undefined);
});
test('iGUIDE embedding recognizes only configured provider tour URLs, preserving query and original link',()=>{
 const href='https://youriguide.com/tour_id?pano=5&rotation=0.2';assert.equal(iGuideSampleHref(href),href);
 assert.equal(iGuideSampleHref('https://www.youriguide.com/embed/tour_id'),'https://www.youriguide.com/embed/tour_id');
 for(const href of ['https://youriguide.com.attacker.invalid/tour','https://attacker-youriguide.com/tour','https://youriguide.com/','https://youriguide.com/blog/page'])assert.equal(iGuideSampleHref(href),undefined);
});
test('restricted Stream URL validation retains exact host/path and refuses appended navigation',()=>{
 const href='https://customer-example.cloudflarestream.com/ae26683a8919895dabdb9b102e5679d3/iframe';assert.equal(streamSampleHref(href),href);
 for(const extra of ['?redirect=https://elsewhere.invalid','#section','/other'])assert.equal(streamSampleHref(href+extra),undefined);
});
