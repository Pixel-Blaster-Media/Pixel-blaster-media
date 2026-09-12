import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {finalObjectResponse,currentFinals,common} from '../../lib/media/finals/application.ts';
export async function grantProof({db,storage,env,scope,actorId,sql,state}){
 const identity={scope,actorId,operator:true},runtime={db,storage,env},packageId=new URL(state.gallery.downloads[0].url,'http://localhost').searchParams.get('download');
 const call=async(name,args)=>{const result=await db.rpc('photo_finals_download_'+name,{...common(identity),...args});if(result.error)throw new Error(String(result.error.message));return result.data;};
 assert.equal(sql(`select count(*) from download_events where actor_profile_id='${actorId}' and event_type='controlled_proxy_completed'`),'2');
 const before=sql(`select count(*) from download_grants where grantee_profile_id='${actorId}'`);
 sql(`create function public.test_only_fail_download_event() returns trigger language plpgsql as $$ begin raise exception 'synthetic audit write failure';end $$;create trigger test_only_fail_download_event before insert on download_events for each row execute function public.test_only_fail_download_event()`);
 try{await assert.rejects(()=>call('begin',{p_operator:true,p_package:packageId,p_request:randomUUID()}));assert.equal(sql(`select count(*) from download_grants where grantee_profile_id='${actorId}'`),before,'audit failure rolls back issuance/accounting');}finally{sql('drop trigger test_only_fail_download_event on download_events;drop function public.test_only_fail_download_event()');}
 const request=randomUUID(),grant=await call('begin',{p_operator:true,p_package:packageId,p_request:request});
 assert.equal(sql(`select resolution_count from download_grants where id='${grant.grantId}'`),'1');
 await assert.rejects(()=>call('begin',{p_operator:true,p_package:packageId,p_request:request}));
 await call('revoke',{p_grant:grant.grantId});
 await call('finish',{p_operator:true,p_grant:grant.grantId,p_request:request,p_completed:true});
 await call('finish',{p_operator:true,p_grant:grant.grantId,p_request:request,p_completed:true});
 assert.equal(sql(`select count(*) from download_events where grant_id='${grant.grantId}' and event_type='denied'`),'1');
 assert.equal(sql(`select count(*) from download_events where grant_id='${grant.grantId}' and event_type='controlled_proxy_completed'`),'0');
 const fresh=await currentFinals(runtime,identity);
 const response=await finalObjectResponse(runtime,identity,fresh,new URLSearchParams({download:packageId}));
 await response.body.cancel();
 assert.equal(sql(`select count(*) from download_events where actor_profile_id='${actorId}' and event_type='denied'`),'2');
 const failing=Object.create(storage);failing.getVerified=async()=>{throw new Error('Synthetic storage read failure');};
 await assert.rejects(()=>finalObjectResponse({...runtime,storage:failing},identity,fresh,new URLSearchParams({download:packageId})));
 assert.equal(sql(`select count(*) from download_events where actor_profile_id='${actorId}' and event_type='denied'`),'3');
 const inFlight=await finalObjectResponse(runtime,identity,fresh,new URLSearchParams({download:packageId}));
 const active=sql(`select id from download_grants where grantee_profile_id='${actorId}' and revoked_at is null order by created_at desc limit 1`);await call('revoke',{p_grant:active});await assert.rejects(()=>inFlight.arrayBuffer());
 assert.equal(sql(`select count(*) from download_events where grant_id='${active}' and event_type='denied'`),'1');
 const denied=await db.rpc('photo_finals_download_begin',{...common(identity),p_actor:randomUUID(),p_operator:true,p_package:packageId,p_request:randomUUID()});assert.ok(denied.error);
 return {atomicIssueAndResolution:true,duplicateBeginDenied:true,revocationDeniesCompletion:true,cancelAndReadFailureAudited:true,settlementIdempotent:true};
}
