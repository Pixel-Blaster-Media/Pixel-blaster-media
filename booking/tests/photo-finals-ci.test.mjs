import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {load} from 'js-yaml';

test('hosted CI runs every finals PostgreSQL gate with isolated pinned prerequisites', async () => {
  const workflow = load(await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  const job = workflow.jobs['photo-finals'];
  assert.ok(job, 'missing hosted photo-finals job');
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.ok(job['timeout-minutes'] >= 20);
  assert.equal(job.env.POSTGRES_BIN, '/usr/lib/postgresql/17/bin');
  assert.equal(job.defaults.run['working-directory'], 'booking');
  assert.equal(job.defaults.run.shell, 'bash'); // GitHub invokes bash with -eo pipefail.
  assert.equal(job.if, undefined, 'finals must run on PRs and main pushes, not opt-in');
  assert.equal(job.services, undefined, 'runners own socket-only PG and ephemeral loopback PostgREST');
  assert.equal(job['continue-on-error'], undefined);
  const runs = job.steps.filter(step => step.run).map(step => step.run);
  const install = runs.join('\n');
  assert.match(install, /apt-get install --yes postgresql-17/);
  assert.match(install, /postgrest-v16\.3-linux-static-x86-64\.tar\.xz/);
  assert.match(install, /4eb414eb948c8800863cc8c9896a17b611b2dccf9ff581f4d57f42ec9ccee40d/);
  assert.match(install, /sha256sum --check --strict/);
  assert.match(install, /playwright@1\.63\.0/);
  assert.match(install, /playwright" install --with-deps chromium/);
  assert.match(install, /PF_PLAYWRIGHT_MODULE=.*index\.mjs/);
  assert.match(install, /PF_CHROME_PATH=.*chromium\.executablePath\(\)/);
  const scripts = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  const required = ['photo-finals', 'finals-ingest', 'finals-packages', 'finals-http', 'finals-postgrest', 'finals-resource', 'finals-long-io'];
  for (const suite of required) {
    const command = `npm run test:postgres:${suite}`;
    assert.ok(scripts[`test:postgres:${suite}`], `${suite} must map to a real runner`);
    const steps = job.steps.filter(step => step.run?.startsWith(command + ' |'));
    assert.equal(steps.length, 1, `${command} must execute exactly once`);
    assert.equal(steps[0].if, undefined);
    assert.equal(steps[0]['continue-on-error'], undefined);
    assert.doesNotMatch(steps[0].run, /\|\|\s*true|&\s*$/);
  }
  const artifact = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.ok(artifact, 'retain actual runner logs and browser evidence');
  assert.equal(artifact.if, 'always()');
  assert.equal(workflow.permissions.contents, 'read');
  assert.doesNotMatch(JSON.stringify(job), /secrets\.|PRODUCTION_SCHEMA|PHOTO_FINALS_PRODUCTION_ACK/);
});
