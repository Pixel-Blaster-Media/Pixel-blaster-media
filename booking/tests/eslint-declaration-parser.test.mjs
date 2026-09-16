import assert from 'node:assert/strict';
import test from 'node:test';
import { ESLint } from 'eslint';

const declaration = 'lib/media/finals/operator-smoke-binding.d.mts';

test('ESLint checks the smoke ESM declaration with the existing TypeScript parser', async () => {
  const eslint = new ESLint();
  const results = await eslint.lintFiles([declaration]);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].messages, []);
  assert.equal(await eslint.isPathIgnored(declaration), false);

  const config = await eslint.calculateConfigForFile(declaration);
  const typescript = await eslint.calculateConfigForFile('lib/media/finals/eslint-probe.d.ts');
  assert.equal(config.languageOptions.parser, typescript.languageOptions.parser);
  assert.deepEqual(config.rules, typescript.rules);

  // Invalid syntax must still fail rather than being silently ignored.
  const [invalid] = await eslint.lintText('export const broken: ;', { filePath: declaration });
  assert.equal(invalid.fatalErrorCount, 1);
});
