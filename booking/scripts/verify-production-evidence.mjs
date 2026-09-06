import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Read-only gate. Approval is an accountable operator attestation, not an
// automatically generated claim that a ledger alone proves compatibility.
const root = resolve(import.meta.dirname, '../..');
function requireThat(ok, message) { if (!ok) throw new Error(message); }
function gh(path, paginate = false) {
  return JSON.parse(execFileSync('gh', ['api', ...(paginate ? ['--paginate', '--slurp'] : []), path], {encoding:'utf8', timeout:60000, maxBuffer:16*1024*1024}));
}
try {
  const sha = execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  requireThat(/^[0-9a-f]{40}$/.test(sha), 'Invalid candidate SHA');
  requireThat(process.env.PRODUCTION_SCHEMA_EVIDENCE, 'PRODUCTION_SCHEMA_EVIDENCE is required');
  requireThat(/^[a-z]{20}$/.test(process.env.PRODUCTION_SUPABASE_PROJECT_REF ?? ''), 'Explicit PRODUCTION_SUPABASE_PROJECT_REF is required');
  const evidence = JSON.parse(readFileSync(process.env.PRODUCTION_SCHEMA_EVIDENCE,'utf8'));
  requireThat(evidence.version === 1 && evidence.candidateSha === sha && evidence.compatible === true, 'Schema approval is not compatible with this exact SHA');
  requireThat(evidence.project === 'pixel-blaster-media' && evidence.rootDirectory === 'booking' && evidence.supabaseProjectRef === process.env.PRODUCTION_SUPABASE_PROJECT_REF, 'Schema approval target mismatch');
  requireThat(typeof evidence.approvedBy === 'string' && evidence.approvedBy.trim().length > 0 && typeof evidence.verification === 'string' && evidence.verification.trim().length > 0, 'Schema approval must identify reviewer and verification evidence');
  const age = Date.now() - Date.parse(evidence.approvedAt);
  requireThat(Number.isFinite(age) && age >= 0 && age <= 60*60*1000, 'Schema approval must be from the past hour');
  const migrationsDir = resolve(root,'booking/supabase/migrations');
  const migrations = readdirSync(migrationsDir).filter(name=>name.endsWith('.sql')).sort().map(name=>({name,sha256:createHash('sha256').update(readFileSync(resolve(migrationsDir,name))).digest('hex')}));
  requireThat(JSON.stringify(evidence.migrations) === JSON.stringify(migrations), 'Schema approval migration manifest does not match candidate bytes');
  const repo = 'Pixel-Blaster-Media/Pixel-blaster-media';
  const runs = gh(`repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&branch=main&event=push&per_page=100`).workflow_runs;
  requireThat(Array.isArray(runs) && runs.length > 0, 'No exact-SHA main push CI run');
  // API returns newest first: a failed/pending newer rerun cannot borrow an old green run.
  const run = runs[0];
  requireThat(run.head_sha === sha && run.head_branch === 'main' && run.event === 'push' && run.path === '.github/workflows/ci.yml' && run.status === 'completed' && run.conclusion === 'success' && Number.isSafeInteger(run.id) && Number.isSafeInteger(run.run_attempt), 'Latest exact-SHA CI run is not successful');
  const pages = gh(`repos/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`, true);
  requireThat(Array.isArray(pages) && pages.every(page=>Array.isArray(page.jobs)), 'Malformed CI jobs response');
  const jobs = pages.flatMap(page=>page.jobs);
  for (const name of ['Application','PostgreSQL integration','Marketing proxy']) {
    const matches = jobs.filter(job=>job.name === name);
    requireThat(matches.length === 1 && matches[0].head_sha === sha && matches[0].status === 'completed' && matches[0].conclusion === 'success', `Missing or unsuccessful exact-SHA job: ${name}`);
  }
  console.log(`Production evidence verified: ${sha}; CI run ${run.id} attempt ${run.run_attempt}; schema approved by ${evidence.approvedBy}`);
} catch (error) {
  console.error(`Production evidence blocked: ${error.message}`);
  process.exitCode = 1;
}
