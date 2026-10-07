import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// This approved admin redesign includes functional loading/scrolling changes,
// covered by studio-workspace.behavior.test.mjs and the browser fixture. Freeze
// its exact reviewed source separately so earlier presentation-only releases can
// still assert their original boundaries without accepting arbitrary new edits.
const snapshot = JSON.parse(readFileSync(new URL('./studio-workspace-snapshot.json', import.meta.url), 'utf8'));
export const studioWorkspacePaths = [...Object.keys(snapshot.files), ...snapshot.added];
export function beforeStudioWorkspace(path, source) {
  if (!snapshot.files[path]) return source;
  assert.equal(createHash('sha256').update(source).digest('hex'), snapshot.files[path], 'reviewed Studio source: ' + path);
  return execFileSync('git', ['show', `${snapshot.base}:booking/${path}`], { cwd: new URL('../..', import.meta.url), encoding: 'utf8' });
}
