// Real independent psql processes; lock waits are observed, not inferred from timers.
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
export async function resumeConcurrency({auth,pkg,release,actorId}){
 const socket=process.env.PF_TEST_SOCKET,psql=process.env.PF_TEST_PSQL;
 const base=['-X','-qAt','-h',socket,'-U','postgres','-v','ON_ERROR_STOP=1'];
 const lit=v=>typeof v==='boolean'||typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
 const rpc=(name,args)=>`select to_jsonb(public.${name}(${Object.entries(args).map(([k,v])=>k+'=>'+lit(v)).join(',')}));`;
 const command=(db,s)=>execFileSync(psql,[...base,'-d',db,'-c',s],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 const children=new Set();
 function session(db,s){
  const p=spawn(psql,[...base,'-d',db],{stdio:['pipe','pipe','pipe']});children.add(p);let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);
  const done=new Promise(resolve=>p.on('exit',code=>{children.delete(p);resolve({code,stdout,stderr});}));p.stdin.write(s+'\n');
  return {p,done,output:()=>stdout};
 }
 const wait=async pred=>{const end=Date.now()+4000;while(!pred()){assert(Date.now()<end,'observable SQL barrier timeout');await new Promise(r=>setTimeout(r,15));}};
 async function race(db,statements){
  const holder=session(db,`begin;select pg_advisory_xact_lock(hashtextextended('finals:'||'${auth.p_org}',0));select 'HELD';`);
  await wait(()=>holder.output().includes('HELD'));
  const jobs=statements.map((s,i)=>session(db,`set application_name='resume-race-${i}';set role service_role;${s}\n\\q`));
  await wait(()=>Number(command(db,"select count(*) from pg_stat_activity where application_name like 'resume-race-%' and wait_event_type='Lock'"))===jobs.length);
  holder.p.stdin.end('commit;\n\\q\n');await holder.done;
  return Promise.all(jobs.map(j=>j.done));
 }
 const results=[];
 for(const mode of ['dispatch','transfer-cap','attempt-cap','withdrawal','supersession','access-rights','mutated-transfer-cap']){
  const db='resume_race_'+randomUUID().replaceAll('-','');command('postgres',`create database ${db} template postgres`);
  try{
   const call=(name,args)=>JSON.parse(command(db,'set role service_role;'+rpc(name,args)));
   const transfer=()=>{const id=randomUUID();call('photo_finals_transfer_begin',{...auth,p_package:pkg.id,p_transfer:id});return id;};
   const begin=t=>rpc('photo_finals_chunk_begin',{...auth,p_transfer:t,p_chunk:0,p_request:randomUUID()});
   if(mode==='transfer-cap'||mode==='mutated-transfer-cap'){
    if(mode==='mutated-transfer-cap'){
     const definition=command(db,"select pg_get_functiondef(oid) from pg_proc where proname='photo_finals_transfer_begin'");
     assert(definition.includes(')>=8'));command(db,definition.replace(')>=8',')>=9'));
    }
    const rows=await race(db,Array.from({length:10},()=>rpc('photo_finals_transfer_begin',{...auth,p_package:pkg.id,p_transfer:randomUUID()})));
    const oracle=()=>assert.equal(rows.filter(r=>r.code===0).length,8);
    if(mode==='mutated-transfer-cap'){assert.throws(oracle,/9 !== 8/);assert.equal(command(db,'select count(*) from media_download_transfers'),'9');}
    else{oracle();assert.equal(command(db,'select count(*) from media_download_transfers'),'8');}
    assert(rows.filter(r=>r.code!==0).every(r=>r.stderr.includes('finals_transfer_limit')));
   }else if(mode==='dispatch'){
    const t=transfer(),rows=await race(db,[begin(t),begin(t)]);assert.equal(rows.filter(r=>r.code===0).length,1);assert(rows.find(r=>r.code!==0).stderr.includes('finals_attempt_already_started'));
    assert.equal(command(db,'select count(*) from media_download_attempts'),'1');
   }else if(mode==='attempt-cap'){
    const ids=Array.from({length:6},transfer),rows=await race(db,ids.map(begin));assert.equal(rows.filter(r=>r.code===0).length,4);assert(rows.filter(r=>r.code!==0).every(r=>r.stderr.includes('finals_attempt_budget')));
    assert.equal(command(db,'select sum(reserved_bytes) from media_download_attempts'),String(Number(pkg.byte_size)*4));
   }else{
    const t=transfer(),a=call('photo_finals_chunk_begin',{...auth,p_transfer:t,p_chunk:0,p_request:randomUUID()});
    const finish=rpc('photo_finals_chunk_finish',{...auth,p_transfer:t,p_attempt:a.attempt.id,p_completed:true,p_emitted_bytes:0});
    const mutation=mode==='access-rights'?`update profiles set archived_at=clock_timestamp() where id='${actorId}';`:`update gallery_releases set state='${mode==='withdrawal'?'withdrawn':'superseded'}'${mode==='withdrawal'?',withdrawn_at=clock_timestamp()':''} where id='${release.id}';`;
    // Handoff owns its real authority locks first; competing mutation must wait.
    const handoff=session(db,'begin;set role service_role;'+finish+begin(t)+"select 'HANDOFF';");await wait(()=>handoff.output().includes('HANDOFF'));
    const pending=JSON.parse(handoff.output().split('\n').find(line=>line.startsWith('{')));
    const change=session(db,"set application_name='resume-mutation';begin;"+mutation+"select 'CHANGED';");
    await wait(()=>command(db,"select wait_event_type from pg_stat_activity where application_name='resume-mutation'")==='Lock');
    handoff.p.stdin.end('commit;\n\\q\n');assert.equal((await handoff.done).code,0);
    await wait(()=>change.output().includes('CHANGED'));
    // Now mutation owns the row. A distinct unsettled handoff waits, then denies.
    const pendingFinish=rpc('photo_finals_chunk_finish',{...auth,p_transfer:t,p_attempt:pending.attempt.id,p_completed:true,p_emitted_bytes:0});
    const replay=session(db,"set application_name='resume-replay';set role service_role;"+pendingFinish+'\n\\q');
    await wait(()=>command(db,"select wait_event_type from pg_stat_activity where application_name='resume-replay'")==='Lock');
    change.p.stdin.end('commit;\n\\q\n');assert.equal((await change.done).code,0);
    const denied=await replay.done;assert.notEqual(denied.code,0);assert.match(denied.stderr,/finals_(transfer_denied|access_denied)/);
    assert.equal(command(db,`select completed is null from media_download_attempts where id='${pending.attempt.id}'`),'t','mutation-first handoff adds no completed coverage');
    assert.equal(command(db,`select completed from media_download_attempts where id='${a.attempt.id}'`),'t','prior handoff is not revoked retroactively');
   }
   results.push({mode,passed:true,separateSessions:true,observedLockWait:true});
  }finally{
   for(const p of children)p.kill('SIGKILL');
   await wait(()=>children.size===0);
   command('postgres',`drop database ${db} with (force)`);
  }
 }
 console.log(JSON.stringify({concurrency:results}));
}
