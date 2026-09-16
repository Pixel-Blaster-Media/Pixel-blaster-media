// Local prerequisite only. No hosted dispatch capability.
import assert from 'node:assert/strict';
import {Socket} from 'node:net';
export function installNoNetwork(){
 const connect=Socket.prototype.connect,fetch=globalThis.fetch;let count=0;
 const deny=()=>{count++;throw new Error('small_pilot_network_forbidden');};
 Socket.prototype.connect=deny;globalThis.fetch=async()=>deny();
 return {attempts:()=>count,restore(){Socket.prototype.connect=connect;globalThis.fetch=fetch;}};
}
export const LIMITS=Object.freeze({app:400,ranges:256,rangeBytes:32*1024*1024,db:4000,dbBytes:8*1024*1024,auth:800,r2A:100,r2B:512,objectBytes:32*1024*1024});
export class Budget {
 #used=Object.fromEntries(Object.keys(LIMITS).map(k=>[k,0]));
 constructor(deadline){this.deadline=deadline;}
 get used(){return Object.freeze({...this.#used});}
 reserve(cost){
  assert.ok(Date.now()<this.deadline,'deadline exhausted');
  for(const [k,v] of Object.entries(cost))assert.ok(Object.hasOwn(LIMITS,k)&&Number.isSafeInteger(v)&&v>=0&&this.#used[k]+v<=LIMITS[k],'budget exhausted/invalid');
  for(const [k,v] of Object.entries(cost))this.#used[k]+=v;
 }
}
export async function makeFixture(){
 const {default:sharp}=await import('sharp');
 const jpeg=await sharp({create:{width:512,height:256,channels:3,background:'#246'}}).jpeg().toBuffer();
 // Legal JPEG COM markers after SOI. Low-entropy transport plumbing only.
 let remaining=8*1024*1024-1024-jpeg.length;const comments=[];
 while(remaining){let size=Math.min(65537,remaining);if(remaining-size>0&&remaining-size<4)size-=4;assert.ok(size>=4);const b=Buffer.alloc(size,0x20);b[0]=0xff;b[1]=0xfe;b.writeUInt16BE(size-2,2);comments.push(b);remaining-=size;}
 return Buffer.concat([jpeg.subarray(0,2),...comments,jpeg.subarray(2)]);
}
export function seedLocal({plan,binding,sql}){
 const i=admit(plan,binding);
 // auth.users here is the existing disposable SQL double, NOT hosted Admin Auth.
 // A company marker keeps the actual Auth trigger profile-less; explicit exact
 // profile/membership follows. Never call company setup or booking aggregate RPCs.
 sql(`begin;
 insert into organizations(id,name,slug) values ('${i.organizationId}','Synthetic small pilot','synthetic-${i.organizationId}');
 insert into auth.users(id,email,raw_app_meta_data) values ('${i.actorId}','pilot@example.invalid','{"company_invitation_id":"${i.requestId}"}');
 insert into profiles(id,organization_id,role,email) values ('${i.actorId}','${i.organizationId}','admin','pilot@example.invalid');
 insert into organization_members values ('${i.organizationId}','${i.actorId}','admin');
 insert into properties(id,organization_id,owner_id,street_address) values ('${i.propertyId}','${i.organizationId}','${i.actorId}','Synthetic - not a real address');
 insert into bookings(id,organization_id,owner_id,property_id,status,scheduled_at,scheduled_ends_at,suppress_realtor_notifications) values ('${i.bookingId}','${i.organizationId}','${i.actorId}','${i.propertyId}','completed',null,null,true);
 commit;`);
 return i;
}
const keys=['actorId','bookingId','intentId','organizationId','propertyId','releaseId','requestId'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function admit(plan,binding){
 assert.equal(plan.target,'isolated-native-postgres','remote target forbidden');
 assert.match(binding,/^[a-f0-9]{64}$/);assert.equal(plan.binding,binding,'stale binding');
 assert.ok(Number.isSafeInteger(plan.expiresAt)&&plan.expiresAt>Date.now()&&plan.expiresAt<=Date.now()+1800000,'stale/overlong admission');
 assert.equal(plan.parentArm,false,'local proof cannot arm parent');
 assert.equal(plan.retention,'inaccessible-audit-rows');
 assert.deepEqual(Object.keys(plan.ids).sort(),keys);
 for(const id of Object.values(plan.ids))assert.match(id,uuid);
 assert.equal(new Set(Object.values(plan.ids)).size,keys.length);
 return Object.freeze({...plan.ids});
}
