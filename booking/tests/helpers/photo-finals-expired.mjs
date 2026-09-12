import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
export async function expiredProof({sql,invoke,job,scope,actorId}){
 const jobId=randomUUID(),version=randomUUID(),sha256=createHash('sha256').update(jobId).digest('hex');
 // Canonical initial inserts, with a deliberately short fixture deadline. No
 // immutable trigger bypass, clock substitution or destructive storage operation.
 sql(`insert into media_versions(id,organization_id,property_id,batch_id,asset_id,version_number)
 select '${version}',organization_id,property_id,batch_id,asset_id,2 from media_versions where id='${job.finals_version_id}';
 insert into media_ingest_jobs(id,organization_id,property_id,batch_id,job_kind,idempotency_key,finals_version_id,finals_sha256,finals_byte_size,finals_quarantine_key,finals_actor_id,finals_deadline)
 values('${jobId}','${scope.organizationId}','${scope.propertyId}','${job.batch_id}','ingest','manual_finals:${jobId}','${version}',decode('${sha256}','hex'),123,'quarantine/${scope.organizationId}/${jobId}/${randomUUID()}','${actorId}',clock_timestamp()+interval '100 milliseconds');
 update media_versions set ingest_state='url_ready' where id='${version}';update media_ingest_jobs set state='url_ready' where id='${jobId}';select pg_sleep(0.15);`);
 const count=sql(`select count(*) from media_ingest_jobs where organization_id='${scope.organizationId}'`);
 const reconciled=await invoke({op:'reconcile'});assert.equal(reconciled.status,200);assert.equal((await reconciled.json()).settled,1);
 assert.equal(sql(`select state||':'||(completed_at is not null)::text from media_ingest_jobs where id='${jobId}'`),'dead_letter:true');
 assert.equal((await (await invoke({op:'reconcile'})).json()).settled,0);
 const replay=await invoke({op:'intent',requestId:randomUUID(),intentId:randomUUID(),sha256,byteSize:123});assert.equal(replay.status,409);assert.equal((await replay.json()).status,'needs_attention');
 assert.equal(sql(`select count(*) from media_ingest_jobs where organization_id='${scope.organizationId}'`),count);
 return {realElapsedExpiry:true,canonicalTerminalization:true,idempotent:true,noReplacement:true};
}
