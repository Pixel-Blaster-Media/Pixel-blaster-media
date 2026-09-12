import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';

test('bounded RPC aborts real thenable transport and reports uncertainty',async()=>{
 const {packageRpc}=await import('../lib/media/finals/package-runtime.ts');
 let signal;
 const db={rpc(){return {abortSignal(s){signal=s;return new Promise((resolve,reject)=>s.addEventListener('abort',()=>reject(s.reason),{once:true}));}};}};
 await assert.rejects(packageRpc(db,'photo_finals_test',{},undefined,20),/finals_package_rpc_timeout/);
 assert.equal(signal.aborted,true);
});
test('lease keepalive renews during awaited IO and aborts immediately on lost ownership',async()=>{
 const {packageLease}=await import('../lib/media/finals/package-runtime.ts');
 let renewals=0;
 const lease=packageLease(async()=>{renewals++;if(renewals===3)throw new Error('lost ownership');},{totalMs:1000,heartbeatMs:10});
 await assert.rejects(delay(200,undefined,{signal:lease.signal}),/aborted/);
 assert.equal(renewals,3);await lease.stop();await delay(30);assert.equal(renewals,3);
});
