import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const names = ['Application', 'PostgreSQL integration', 'Marketing proxy'];
function scenario(change = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'release-guard-'));
  const repo = join(dir, 'repo'); mkdirSync(repo);
  const run = (cmd, args, options = {}) => spawnSync(cmd, args, { cwd: repo, encoding: 'utf8', ...options });
  try {
    mkdirSync(join(repo, 'booking/scripts'), {recursive:true});
    cpSync(new URL('../scripts/', import.meta.url), join(repo, 'booking/scripts'), {recursive:true});
    mkdirSync(join(repo, 'booking/supabase/migrations'), {recursive:true});
    writeFileSync(join(repo, 'booking/supabase/migrations/20260101000000_fixture.sql'), 'select 1;\n');
    writeFileSync(join(repo, '.gitignore'), '.vercel/\n');
    for (const args of [['init','-b','main'],['config','user.email','fixture@example.invalid'],['config','user.name','Fixture'],['add','.'],['commit','-qm','fixture'],['remote','add','origin',repo]]) assert.equal(run('git',args).status,0);
    const sha = run('git',['rev-parse','HEAD']).stdout.trim();
    mkdirSync(join(repo,'.vercel')); writeFileSync(join(repo,'.vercel/project.json'), JSON.stringify({projectId:'prj_QmEJtyuVnVhXILDCJiTPbZr2EdT5',projectName:'pixel-blaster-media'}));
    const evidence = {version:1, candidateSha:sha, project:'pixel-blaster-media', rootDirectory:'booking', supabaseProjectRef:'xjqgqjhrduqysxqlgfby', approvedBy:'fixture reviewer', approvedAt:new Date().toISOString(), compatible:true, migrations:[{name:'20260101000000_fixture.sql',sha256:createHash('sha256').update('select 1;\n').digest('hex')}], verification:'read-only live schema and ledger review; fixture only'};
    const runs = {workflow_runs:[{id:123,head_sha:sha,event:'push',head_branch:'main',path:'.github/workflows/ci.yml',status:'completed',conclusion:'success',run_attempt:1}]};
    const jobs = [{jobs:names.map(name=>({name,head_sha:sha,status:'completed',conclusion:'success'}))}];
    const state = {evidence,runs,jobs,omitEvidence:false}; change(state);
    const bin = join(dir,'bin'); mkdirSync(bin);
    const marker = join(dir,'deployed');
    writeFileSync(join(bin,'vercel'), `#!/bin/sh\nif [ "$1" = project ]; then printf 'prj_QmEJtyuVnVhXILDCJiTPbZr2EdT5\\nRoot Directory booking\\n'; else touch '${marker}'; fi\n`,{mode:0o755});
    writeFileSync(join(bin,'gh'), `#!/usr/bin/env node\nconst a=process.argv.join(' '); console.log(JSON.stringify(a.includes('/jobs')?${JSON.stringify(jobs)}:${JSON.stringify(runs)}));\n`,{mode:0o755});
    const path = join(dir,'schema.json'); writeFileSync(path,JSON.stringify(evidence));
    const result = run('bash',['booking/scripts/deploy-production.sh'],{env:{...process.env,PATH:`${bin}:${process.env.PATH}`,PRODUCTION_SUPABASE_PROJECT_REF:evidence.supabaseProjectRef,PRODUCTION_SCHEMA_EVIDENCE:state.omitEvidence?'':path}});
    return {status:result.status,output:result.stdout+result.stderr,deployed: (()=>{try {readFileSync(marker);return true;}catch{return false;}})()};
  } finally {rmSync(dir,{recursive:true,force:true});}
}
for (const [name,change] of [
  ['missing schema approval',s=>s.omitEvidence=true],
  ['wrong candidate schema approval',s=>s.evidence.candidateSha='a'.repeat(40)],
  ['incompatible schema',s=>s.evidence.compatible=false],
  ['changed migration bytes',s=>s.evidence.migrations[0].sha256='a'.repeat(64)],
  ['stale schema approval',s=>s.evidence.approvedAt='2020-01-01T00:00:00Z'],
  ['failed CI',s=>s.runs.workflow_runs[0].conclusion='failure'],
  ['wrong CI SHA',s=>s.runs.workflow_runs[0].head_sha='b'.repeat(40)],
  ['missing PostgreSQL job',s=>s.jobs[0].jobs.splice(1,1)],
  ['skipped application job',s=>s.jobs[0].jobs[0].conclusion='skipped'],
  ['wrong job SHA',s=>s.jobs[0].jobs[0].head_sha='b'.repeat(40)],
  ['duplicate required job',s=>s.jobs[0].jobs.push({...s.jobs[0].jobs[0]})],
  ['PR-only CI evidence',s=>s.runs.workflow_runs[0].event='pull_request'],
  ['wrong Vercel evidence target',s=>s.evidence.project='booking'],
  ['future-dated approval',s=>s.evidence.approvedAt='2999-01-01T00:00:00Z'],
]) test(`deploy rejects ${name} before mutation`,()=>{const r=scenario(change);assert.notEqual(r.status,0,r.output);assert.match(r.output,/Production evidence blocked/);assert.equal(r.deployed,false);});
test('deploy accepts exact successful CI and fresh approved schema evidence',()=>{const r=scenario();assert.equal(r.status,0,r.output);assert.equal(r.deployed,true);});
test('deploy validates required jobs across paginated responses',()=>{const r=scenario(s=>s.jobs.push({jobs:s.jobs[0].jobs.splice(1)}));assert.equal(r.status,0,r.output);assert.equal(r.deployed,true);});
