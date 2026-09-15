import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('composite native transform rechecks absolute reserve after validation',()=>{
 const result=spawnSync(process.execPath,['--experimental-test-module-mocks',new URL('./helpers/photo-finals-native-admission.mjs',import.meta.url).pathname],{encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+result.stderr);
 console.log(result.stdout.trim());
});
