import test from 'node:test';import assert from 'node:assert/strict';
test('send-time selection reads fresh Pixel state; iGUIDE per-slot and video survive read failure',async()=>{
 const m=await import('../lib/media/finals/delivery.ts').catch(()=>null);assert.ok(m,'fresh finals delivery resolver required');
 const incumbent=[{category:'photos',source:'iguide',slot:'photos_mls',url:'https://example.invalid/iguide',label:'iGUIDE'},{category:'video',source:'manual',url:'https://example.invalid/video',label:'Video'}];
 const pixel=[{category:'photos',source:'pixel_release',slot:'photos_mls',url:'/mls',label:'MLS'},{category:'photos',source:'pixel_release',slot:'photos_full_res',url:'/full',label:'Full'}];
 let fresh=0;const read=async()=>{fresh++;return {gallery:fresh===1?{downloads:pixel}:null};};
 assert.deepEqual((await m.resolveFinalsDelivery(incumbent,read)).map(x=>x.url),['https://example.invalid/iguide','/full','https://example.invalid/video']);
 assert.deepEqual(await m.resolveFinalsDelivery(incumbent,read),incumbent);assert.equal(fresh,2);
 assert.deepEqual(await m.resolveFinalsDelivery(incumbent,async()=>{throw new Error('read failure')}),incumbent);
});
