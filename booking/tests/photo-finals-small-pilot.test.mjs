import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as pilot from '../scripts/photo-finals-small-pilot.mjs';
const ids=()=>Object.fromEntries(['organizationId','actorId','propertyId','bookingId','requestId','intentId','releaseId'].map(k=>[k,randomUUID()]));
test('budget reserves before dispatch, retains failed charges and rejects unsafe costs/deadline',()=>{
 assert.equal(typeof pilot.Budget,'function','missing budget');
 const b=new pilot.Budget(Date.now()+60000);
 b.reserve({app:1,rangeBytes:131072});assert.equal(b.used.app,1);
 assert.throws(()=>b.reserve({app:400}));assert.equal(b.used.app,1);
 for(const cost of [{app:-1},{app:NaN},{app:1.5},{unknown:1}])assert.throws(()=>b.reserve(cost));
 b.reserve({app:399});assert.throws(()=>b.reserve({app:1}));
 const expired=new pilot.Budget(0);assert.throws(()=>expired.reserve({app:1}));
 assert.equal(b.used.rangeBytes,131072,'no refund API for uncertainty');
});
test('fixture is a bounded decodable synthetic JPEG, not arbitrary ZIP bytes',async()=>{
 assert.equal(typeof pilot.makeFixture,'function','missing valid JPEG fixture');
 const bytes=await pilot.makeFixture();assert.equal(bytes.length,8*1024*1024-1024);
 const {default:sharp}=await import('sharp');const image=await sharp(bytes).metadata();
 assert.equal(image.format,'jpeg');assert.equal(image.width,512);assert.equal(image.height,256);
 await sharp(bytes).raw().toBuffer();
});
test('local execution fence rejects all network service calls',async()=>{
 assert.equal(typeof pilot.installNoNetwork,'function','missing execution fence');
 const fence=pilot.installNoNetwork();
 try{await assert.rejects(fetch('https://example.invalid'),/small_pilot_network_forbidden/);const {Socket}=await import('node:net');assert.throws(()=>new Socket().connect(443,'example.invalid'),/small_pilot_network_forbidden/);assert.equal(fence.attempts(),2);}finally{fence.restore();}
});
const plan=()=>({target:'isolated-native-postgres',ids:ids(),binding:'a'.repeat(64),expiresAt:Date.now()+60000,retention:'inaccessible-audit-rows',parentArm:false});
test('local seed admission requires explicit target, exact registered tuple and fresh binding',()=>{
 assert.equal(typeof pilot.admit,'function','missing local small-pilot admission');
 const p=plan();assert.deepEqual(pilot.admit(p,p.binding),p.ids);
 for(const change of [{target:'https://pixelblastermedia.com'},{ids:{...p.ids,bookingId:'customer'}},{binding:'b'.repeat(64)},{expiresAt:0},{parentArm:true},{retention:'delete-all'}])assert.throws(()=>pilot.admit({...p,...change},p.binding));
});
