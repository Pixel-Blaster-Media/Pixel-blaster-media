import test from 'node:test';
import assert from 'node:assert/strict';
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',session='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const token=(sub=actor,sid=session)=>'x.'+Buffer.from(JSON.stringify({sub,session_id:sid})).toString('base64url')+'.x';
test('session identity is accepted only after authoritative verification of this exact token',async()=>{
 const m=await import('../lib/media/finals/resume-session.ts').catch(()=>({}));assert.equal(typeof m.verifiedResumeSession,'function');
 const calls=[];const auth={getSession:async()=>({data:{session:{access_token:token()}},error:null}),getUser:async t=>{calls.push(t);return {data:{user:{id:actor}},error:null};}};
 const first=await m.verifiedResumeSession(auth);assert.equal(first.actorId,actor);assert.match(first.sessionHash,/^[a-f0-9]{64}$/);assert.deepEqual(calls,[token()]);
 assert.equal(await m.verifiedResumeSession({...auth,getUser:async()=>({data:{user:{id:session}},error:null})}),null);
 assert.equal(await m.verifiedResumeSession({...auth,getUser:async()=>({data:{user:null},error:{}})}),null);
 assert.equal(await m.verifiedResumeSession({...auth,getSession:async()=>({data:{session:{access_token:token(actor,'')}},error:null})}),null);
 const changed=await m.verifiedResumeSession({...auth,getSession:async()=>({data:{session:{access_token:token(actor,actor)}},error:null})});assert.notEqual(changed.sessionHash,first.sessionHash);
});
