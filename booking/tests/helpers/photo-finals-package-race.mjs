import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
// Both sessions are actual service_role. A Lock wait plus blocker is mandatory;
// timeouts are failure bounds, never evidence that a race overlapped.
export async function observedRace({sql,socket,first,second,errorPattern}){
 const args=['-X','-qAt','-h',socket,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
 const holder=spawn(process.env.PF_TEST_PSQL,args),contender=spawn(process.env.PF_TEST_PSQL,args);
 let holderOut='',holderErr='',otherOut='',otherErr='';
 holder.stdout.on('data',b=>holderOut+=b);holder.stderr.on('data',b=>holderErr+=b);
 contender.stdout.on('data',b=>otherOut+=b);contender.stderr.on('data',b=>otherErr+=b);
 const exit=p=>new Promise(resolve=>p.on('exit',code=>resolve(code)));
 const hExit=exit(holder),cExit=exit(contender);
 try{
  holder.stdin.write(`set role service_role;begin;set local statement_timeout='15s';${first};select 'HELD';\n`);
  let observed=false;
  for(let n=0;n<300;n++){if(holderOut.includes('HELD'))break;assert.equal(holder.exitCode,null,holderErr);await delay(20);}
  assert.ok(holderOut.includes('HELD'),holderErr);
  contender.stdin.end(`set application_name='package_race_contender';set role service_role;set statement_timeout='15s';${second};\n`);
  for(let n=0;n<300;n++){
   if(sql("select count(*) from pg_stat_activity where application_name='package_race_contender' and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0")==='1'){observed=true;break;}
   assert.equal(contender.exitCode,null,otherErr);await delay(20);
  }
  assert.ok(observed,'contender must actually block');holder.stdin.end('commit;\n');
  assert.equal(await hExit,0,holderErr);const code=await cExit;
  if(errorPattern){assert.notEqual(code,0);assert.match(otherErr,errorPattern);}else assert.equal(code,0,otherErr);
  return {observedLockWait:true,output:otherOut};
 }finally{for(const p of [holder,contender])if(p.exitCode===null)p.kill('SIGKILL');}
}
